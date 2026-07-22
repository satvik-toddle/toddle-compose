import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DocumentType, Prisma, WorkspaceRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { DocumentCacheService } from "./document-cache.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import { WorkspaceEventsService } from "../realtime/realtime.service";
import type { RtcRole } from "../rtc/rtc-token.service";
import type { AuthUser } from "../auth/current-user.decorator";
import { trace } from "../tracing/trace";

const OWNER_SELECT = { id: true, name: true, color: true } as const;

// The shared document-summary projection, lifted to a const so both the cache and the
// DocRow type below stay in lockstep with what every read/write returns.
const SUMMARY_SELECT = {
  id: true,
  title: true,
  icon: true,
  type: true,
  workspaceId: true,
  folderId: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: OWNER_SELECT },
} as const;

// Cached/returned row shape, derived from SUMMARY_SELECT so it can never drift from the query.
type DocRow = Prisma.DocumentGetPayload<{ select: typeof SUMMARY_SELECT }>;

type CreateDocumentInput = {
  title?: string;
  icon?: string;
  type?: "DOC" | "SHEET";
  folderId?: string;
  // When set, folderId is ignored — a subdoc is located by its parent.
  parentId?: string;
  workspaceId?: string;
};

type ListDocumentsInput = {
  folderId?: string;
  // null → top-level docs only; a string → that parent's direct children.
  parentId?: string | null;
  workspaceId?: string;
};
type MoveDocumentInput = {
  // Move into a folder (omit/null → workspace root). Mutually exclusive with parentId.
  folderId?: string | null;
  // Re-parent under another document (omit/null → detach). Wins over folderId.
  parentId?: string | null;
};

type Breadcrumb = { id: string; title: string; icon: string | null };

// `children` is populated only for nodes on the expanded spine; off-path siblings get null + childCount.
type HierarchyNode = {
  id: string;
  title: string;
  icon: string | null;
  type: DocumentType;
  parentId: string | null;
  childCount: number;
  // Per-user: false in the shared cache; the real value is overlaid per request (see hierarchy()).
  isStarred: boolean;
  children: HierarchyNode[] | null;
};

// Bounds breadcrumb/ancestor walks so a corrupt self-referential chain can't loop.
const MAX_DOC_DEPTH = 256;

// ~120-char content excerpt centered on the query term (…ellipsized), for search-result rows.
function makeSnippet(text: string, q: string): string {
  const WINDOW = 120;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) {
    const head = text.slice(0, WINDOW).replace(/\s+/g, " ").trim();
    return head.length < text.trim().length ? `${head}…` : head;
  }
  // Clamp the lead offset non-negative: a q longer than WINDOW would otherwise push start past idx, dropping the match.
  const start = Math.max(0, idx - Math.max(0, Math.floor((WINDOW - q.length) / 2)));
  const end = Math.min(text.length, start + WINDOW);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly rtc: RtcInternalClient,
    private readonly cache: DocumentCacheService,
    private readonly events: WorkspaceEventsService
  ) {}

  // Single funnel for by-id metadata-row reads: serve a fresh cached row, else load from the
  // DB and cache it (lazy fill). Returns null when the document does not exist (not cached).
  // The cached value is the summarySelect() shape; callers still gate access per-user on top.
  private async loadDocRow(id: string): Promise<DocRow | null> {
    const cached = this.cache.get(id) as DocRow | undefined;
    if (cached) return cached;
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: this.summarySelect(),
    });
    if (doc) this.cache.set(id, doc);
    return doc;
  }

  // Write-through: await the committed DB mutation, then refresh the cache from the row it
  // returns so the next reader sees the update. DB-first ordering means a failed write never
  // poisons the cache. (In-memory + per-instance — see DocumentCacheService for the caveat.)
  private async writeThrough(update: Promise<DocRow>): Promise<DocRow> {
    const row = await update;
    this.cache.set(row.id, row);
    return row;
  }

  private async invalidateChildSet(parentId: string | null): Promise<void> {
    if (!parentId) return;
    this.cache.invalidateChildren(parentId);
    const parent = await this.loadDocRow(parentId);
    if (parent?.parentId) this.cache.invalidateChildren(parent.parentId);
  }

  // Documents in the (active or given) workspace, optionally narrowed to a folder.
  // TODO(pagination): offset-based for now; move to cursor-based once workspaces grow large (tracked in Coda).
  async list(
    user: AuthUser,
    input: ListDocumentsInput = {},
    skip = 0,
    take = 100
  ) {
    return trace("documents.list", async () => {
      const wsId = this.resolveWorkspaceId(user, input.workspaceId);
      const { role: wsRole } = await this.authz.requireWorkspaceAccess(user.id, wsId);

      // Grant-only guest (role null): return only their granted docs, ignoring folder/parent filters.
      if (wsRole === null) {
        const granted = await this.prisma.document.findMany({
          where: { workspaceId: wsId, permissions: { some: { userId: user.id } } },
          select: this.summarySelect(),
          // id tiebreaker so offset pages don't skip/dup docs sharing an updatedAt.
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip,
          take,
        });
        return this.attachMyRole(
          user.id,
          await this.attachStarred(user.id, granted),
          new Map([[wsId, wsRole]])
        );
      }

      // A folder filter must reference a folder of THIS workspace (404 otherwise).
      if (input.folderId !== undefined) {
        await this.requireFolderInWorkspace(input.folderId, wsId);
      }
      const folderScope =
        input.folderId === undefined ? {} : { folderId: input.folderId };

      // null → top-level only; a string parent must live in this workspace (404 otherwise).
      if (typeof input.parentId === "string") {
        await this.requireDocInWorkspace(input.parentId, wsId);
      }
      const parentScope =
        input.parentId === undefined ? {} : { parentId: input.parentId };

      const docs = await this.prisma.document.findMany({
        where: { workspaceId: wsId, ...folderScope, ...parentScope },
        select: this.summarySelect(),
        // id tiebreaker so offset pages don't skip/dup docs sharing an updatedAt.
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip,
        take,
      });
      return this.attachMyRole(
        user.id,
        await this.attachStarred(user.id, docs),
        new Map([[wsId, wsRole]])
      );
    });
  }

  // Keyset (seek) pagination over the matched union, ordered (updatedAt desc, id desc) — no OFFSET scan.
  // The same access filter gates every query, so a doc the user can't read never surfaces.
  async search(
    user: AuthUser,
    input: { workspaceId?: string; q: string; cursor?: string | null },
    take = 25
  ) {
    return trace("documents.search", async () => {
      const empty = {
        items: [],
        total: 0,
        nextCursor: null as string | null,
      };
      const q = input.q.trim();
      if (q === "") return empty;

      const global = input.workspaceId === undefined;

      // Access filter reused by every query below, keeping title + content passes in lockstep.
      let accessFilter: Prisma.DocumentWhereInput;
      if (!global) {
        const wsId = this.resolveWorkspaceId(user, input.workspaceId);
        const { role: wsRole } = await this.authz.requireWorkspaceAccess(user.id, wsId);
        // Grant-only guest (role null): only their granted docs in this workspace.
        accessFilter =
          wsRole === null
            ? { workspaceId: wsId, permissions: { some: { userId: user.id } } }
            : { workspaceId: wsId };
      } else {
        // Global: any member workspace (incl. realm OWNER/MAINTAINER overlay) OR a per-page grant.
        const memberWsIds = await this.authz.memberWorkspaceIds(user.id);
        accessFilter = {
          OR: [
            { workspaceId: { in: memberWsIds } },
            { permissions: { some: { userId: user.id } } },
          ],
        };
      }

      // Global results carry workspace {id,name} so callers can navigate + label; workspace scope omits it.
      const select = global
        ? ({
            ...SUMMARY_SELECT,
            workspace: { select: { id: true, name: true } },
          } as const)
        : SUMMARY_SELECT;

      // ONE indexed query: title OR content substring match, gated by the access filter. Both
      // columns are pg_trgm GIN-indexed, so content search is exhaustive and sub-linear — no
      // rtc round-trip, no id cap, and zero load on the collab server (content_text is pushed
      // here by rtc on each snapshot flush).
      const matchWhere: Prisma.DocumentWhereInput = {
        AND: [
          accessFilter,
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { contentText: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      };
      const total = await this.prisma.document.count({ where: matchWhere });

      // Keyset seek: page rows strictly "after" the cursor in (updatedAt desc, id desc) order.
      const cur = this.decodeSearchCursor(input.cursor);
      const seekClause: Prisma.DocumentWhereInput | null = cur
        ? {
            OR: [
              { updatedAt: { lt: cur.updatedAt } },
              { AND: [{ updatedAt: cur.updatedAt }, { id: { lt: cur.id } }] },
            ],
          }
        : null;

      const page = await this.prisma.document.findMany({
        where: seekClause ? { AND: [matchWhere, seekClause] } : matchWhere,
        // contentText only for snippet building; stripped from the returned row below.
        select: { ...select, contentText: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
      });

      const ql = q.toLowerCase();
      // A doc matching BOTH keeps match:"title" (badge) but also carries its content snippet.
      const ordered = page.map(({ contentText, ...d }) => ({
        ...d,
        match: d.title.toLowerCase().includes(ql) ? ("title" as const) : ("content" as const),
        snippet:
          contentText && contentText.toLowerCase().includes(ql)
            ? makeSnippet(contentText, q)
            : undefined,
      }));
      const items = await this.attachMyRole(
        user.id,
        await this.attachStarred(user.id, ordered)
      );

      const last = page[page.length - 1];
      const nextCursor =
        page.length === take && last
          ? this.encodeSearchCursor(last.updatedAt, last.id)
          : null;
      return { items, total, nextCursor };
    });
  }

  // Opaque keyset cursor over (updatedAt, id) — base64url so it survives a query string.
  private encodeSearchCursor(updatedAt: Date, id: string): string {
    return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString("base64url");
  }

  private decodeSearchCursor(
    cursor?: string | null
  ): { updatedAt: Date; id: string } | null {
    if (!cursor) return null;
    try {
      const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
      const updatedAt = new Date(ts);
      if (!id || Number.isNaN(updatedAt.getTime())) return null;
      return { updatedAt, id };
    } catch {
      return null;
    }
  }

  // Direct subdocs of a document; workspace READ on the parent gates the whole list.
  async listSubdocs(userId: string, parentId: string, skip = 0, take = 100) {
    const { doc: parent, wsRole, grant } = await this.requireDocRead(userId, parentId);
    const isNonMember = parent.owner.id !== userId && wsRole === null;
    // No cascade: a grant-only caller (not owner, no workspace role) sees an empty child list.
    if (isNonMember && grant !== null) return [];
    const docs = await this.prisma.document.findMany({
      where: { parentId: parent.id },
      select: this.summarySelect(),
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    });
    return this.attachStarred(userId, docs);
  }

  // The current user's starred docs in a workspace, most-recently-starred first.
  // Filters via the relation so only this workspace's stars are returned.
  async listStarred(
    user: AuthUser,
    input: { workspaceId?: string } = {},
    skip = 0,
    take = 100
  ) {
    const wsId = this.resolveWorkspaceId(user, input.workspaceId);
    const { role: wsRole } = await this.authz.requireWorkspaceAccess(user.id, wsId);

    // Grant-only guest (role null): scope the star join to their granted docs.
    if (wsRole === null) {
      const grantedStars = await this.prisma.documentStar.findMany({
        where: {
          userId: user.id,
          document: { workspaceId: wsId, permissions: { some: { userId: user.id } } },
        },
        select: { document: { select: this.summarySelect() } },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      });
      const grantedDocs = grantedStars.map((s) => ({ ...s.document, isStarred: true as const }));
      return this.attachMyRole(user.id, grantedDocs, new Map([[wsId, wsRole]]));
    }

    const stars = await this.prisma.documentStar.findMany({
      where: { userId: user.id, document: { workspaceId: wsId } },
      select: { document: { select: this.summarySelect() } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
    const docs = stars.map((s) => ({ ...s.document, isStarred: true as const }));
    return this.attachMyRole(user.id, docs, new Map([[wsId, wsRole]]));
  }

  // Every doc shared with the caller across ALL workspaces (grants only, excludes owned),
  // newest grant first — powers the launcher's global "Shared with me" view. Each row
  // carries its workspace {id, name}, the grant date, and the caller's effective role.
  async listAllSharedWithMe(user: AuthUser, skip = 0, take = 200) {
    const grants = await this.prisma.documentPermission.findMany({
      where: { userId: user.id, document: { NOT: { ownerId: user.id } } },
      select: {
        role: true,
        createdAt: true,
        document: {
          select: {
            ...this.summarySelect(),
            workspace: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
    // Effective role = max(workspace role, grant); resolve each distinct workspace once, in parallel.
    const wsRoleByWs = new Map<string, WorkspaceRole | null>();
    await Promise.all(
      [...new Set(grants.map((g) => g.document.workspaceId))].map(async (wsId) =>
        wsRoleByWs.set(wsId, await this.authz.effectiveWorkspaceRole(user.id, wsId))
      )
    );
    // One batched star lookup for all returned ids so each row carries the caller's isStarred.
    const starred = await this.starredIdSet(
      user.id,
      grants.map((g) => g.document.id)
    );
    return grants.map((g) => ({
      ...g.document,
      isStarred: starred.has(g.document.id),
      sharedAt: g.createdAt,
      myRole: this.authz.maxWorkspaceRole(wsRoleByWs.get(g.document.workspaceId) ?? null, g.role)!,
    }));
  }

  // Sidebar hierarchy: root ancestor expanded down the spine, each on-path node listing its children.
  // Gated to workspace members/owner: unlike GET /:id, a grant-only viewer gets 404.
  async hierarchy(userId: string, id: string): Promise<HierarchyNode> {
    const { doc, wsRole } = await this.requireDocRead(userId, id);
    if (doc.owner.id !== userId && wsRole === null) {
      throw new NotFoundException("document not found");
    }

    const pathIds = await this.ancestorIds(id); // root → current
    const childrenByParent = new Map<string, HierarchyNode[]>();
    for (const pid of pathIds) {
      childrenByParent.set(pid, await this.loadDirectChildren(pid));
    }
    const metaById = await this.loadNodeMeta(pathIds);

    // Build bottom-up, grafting each level onto its parent in place of the collapsed on-path child.
    let built: HierarchyNode = this.makeNode(
      metaById.get(id)!,
      childrenByParent.get(id) ?? []
    );
    for (let i = pathIds.length - 2; i >= 0; i--) {
      const pid = pathIds[i];
      const onPathChildId = pathIds[i + 1];
      const siblings = (childrenByParent.get(pid) ?? []).map((s) =>
        s.id === onPathChildId ? built : s
      );
      built = this.makeNode(metaById.get(pid)!, siblings);
    }

    // Overlay this user's stars. withStarred clones every node, so the shared
    // child-set cache (which holds isStarred: false placeholders) is never mutated.
    const nodeIds: string[] = [];
    this.collectNodeIds(built, nodeIds);
    const starred = await this.starredIdSet(userId, nodeIds);
    return this.withStarred(built, starred);
  }

  async create(user: AuthUser, input: CreateDocumentInput) {
    return trace("documents.create", async () => {
      const wsId = this.resolveWorkspaceId(user, input.workspaceId);
      await this.authz.requireWorkspaceRole(user.id, wsId, "EDIT");

      // parentId wins over folderId — a subdoc is located by its parent.
      if (input.parentId) await this.requireDocInWorkspace(input.parentId, wsId);
      else if (input.folderId)
        await this.requireFolderInWorkspace(input.folderId, wsId);

      const type = (input.type as DocumentType) ?? DocumentType.DOC;
      const doc = await this.prisma.document.create({
        data: {
          title: input.title,
          icon: input.icon ?? null,
          type,
          workspaceId: wsId,
          ownerId: user.id,
          parentId: input.parentId ?? null,
          folderId: input.parentId ? null : (input.folderId ?? null),
        },
        select: this.summarySelect(),
      });
      // Write-through: a freshly-created doc is hot, so seed the cache for the read that follows.
      this.cache.set(doc.id, doc);
      if (doc.parentId) await this.invalidateChildSet(doc.parentId);
      // Best-effort, non-blocking RTC provisioning: the rtc-server also creates the row lazily on first connect.
      void this.rtc.initDocBestEffort(doc.id);
      // Push to every member streaming this workspace so their side panel reflects the new doc live.
      this.events.documentCreated(wsId, doc);
      return doc;
    });
  }

  // RTC role for the token: editor for owner/EDIT+, viewer for READ/COMMENT; 404/403 when no access.
  async resolveRtcRole(userId: string, docId: string): Promise<RtcRole> {
    const doc = await this.loadDocRow(docId);
    if (!doc) throw new NotFoundException("document not found");

    if (doc.owner.id === userId) return "editor";

    // Effective doc role = MAX(workspace role, per-page grant) — grants only ever elevate,
    // so a READ/COMMENT grant on top of a member's EDIT still mints an editor token.
    const [wsRole, grant] = await Promise.all([
      this.authz.effectiveWorkspaceRole(userId, doc.workspaceId),
      this.authz.docGrantRole(userId, docId),
    ]);
    const effective = this.authz.maxWorkspaceRole(wsRole, grant);
    if (effective === "ADMIN" || effective === "EDIT") return "editor";
    if (effective === "READ" || effective === "COMMENT") return "viewer";

    throw new ForbiddenException("no access to this document");
  }

  // Read a document plus its ancestor breadcrumbs; the collaborative body lives in the rtc-database, not here.
  async get(userId: string, id: string) {
    const { doc, wsRole, grant } = await this.requireDocRead(userId, id);
    // Grant-only caller: collapse breadcrumbs to this doc so ancestor titles don't leak.
    const isGrantOnly =
      doc.owner.id !== userId && wsRole === null && grant !== null;
    const breadcrumbs = isGrantOnly
      ? [{ id: doc.id, title: doc.title, icon: doc.icon }]
      : await this.buildBreadcrumbs(doc.id);
    const isStarred = await this.isStarred(userId, doc.id);
    const myRole: WorkspaceRole | null =
      doc.owner.id === userId ? "ADMIN" : this.authz.maxWorkspaceRole(wsRole, grant);
    return { ...doc, isStarred, breadcrumbs, myRole };
  }

  // Read gate shared by `get`/`listSubdocs`; 404 (not 403) so a hidden doc's existence isn't revealed.
  // Returns the roles it resolved so callers never re-query them (owner short-circuits with nulls).
  private async requireDocRead(
    userId: string,
    id: string
  ): Promise<{
    doc: NonNullable<Awaited<ReturnType<DocumentsService["loadDocRow"]>>>;
    wsRole: WorkspaceRole | null;
    grant: WorkspaceRole | null;
  }> {
    const doc = await this.loadDocRow(id);
    if (!doc) throw new NotFoundException("document not found");

    if (doc.owner.id === userId) return { doc, wsRole: null, grant: null };

    // Grant is fetched alongside the workspace role: it can elevate a member's effective role too.
    const [wsRole, grant] = await Promise.all([
      this.authz.effectiveWorkspaceRole(userId, doc.workspaceId),
      this.authz.docGrantRole(userId, id),
    ]);
    if (wsRole !== null || grant !== null) return { doc, wsRole, grant };

    throw new NotFoundException("document not found");
  }

  // Parent chain root → current; bounded by MAX_DOC_DEPTH + visited set so a corrupt chain can't loop.
  private async buildBreadcrumbs(id: string): Promise<Breadcrumb[]> {
    const chain: Breadcrumb[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    for (let i = 0; cursor !== null && i < MAX_DOC_DEPTH; i++) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const node = await this.loadDocRow(cursor);
      if (!node) break;
      chain.push({ id: node.id, title: node.title, icon: node.icon });
      cursor = node.parentId;
    }
    return chain.reverse();
  }

  // Per-author edit sessions, newest first; rtc DB stores only clientSub, so we join names/colors from the app DB.
  async history(userId: string, docId: string) {
    await this.get(userId, docId); // read-access gate
    const { head, sessions } = await this.rtc.getSessions(docId);

    const subs = [
      ...new Set(
        sessions
          .map((s) => s.clientSub)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ];
    const users = subs.length
      ? await this.prisma.user.findMany({
          where: { id: { in: subs } },
          select: { id: true, name: true, email: true, color: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      docId,
      head,
      sessions: sessions
        .map((s) => ({
          firstSeq: s.firstSeq,
          lastSeq: s.lastSeq,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          updateCount: s.updateCount,
          totalBytes: s.totalBytes,
          noop: s.noop,
          // Archive snapshot vs. real edit whose author no longer resolves (both leave user=null; the UI labels them differently).
          kind: s.origin === "archive" ? ("archive" as const) : ("edit" as const),
          changedCells: s.changedCells ?? [],
          user: s.clientSub ? (byId.get(s.clientSub) ?? null) : null,
        }))
        .reverse(), // newest first
    };
  }

  // Read-only preview of the document at a given seq; the kind is resolved from the doc, then dispatched on.
  async historySnapshot(
    userId: string,
    docId: string,
    seq: number,
    // Baseline seq to also return a merged server-computed diff (0 = empty doc); DOC only.
    diffAgainst?: number
  ) {
    const doc = await this.get(userId, docId);
    if (!Number.isInteger(seq) || seq < 0) {
      throw new BadRequestException("seq must be a non-negative integer");
    }
    if (diffAgainst != null && (!Number.isInteger(diffAgainst) || diffAgainst < 0)) {
      throw new BadRequestException("diff must be a non-negative integer");
    }
    // Fetch only the slice each doc type renders: DOC gets server-extracted editorState JSON (+ optional diff), SHEET reads the grid snapshot.
    const isSheet = doc.type === DocumentType.SHEET;
    const preview = await this.rtc.getVersionPreview(
      docId,
      seq,
      isSheet ? "text" : "render",
      isSheet ? undefined : diffAgainst
    );
    const base = { docId, type: doc.type, seq: preview.seq, headSeq: preview.headSeq };

    // Seam where DOC and SHEET data diverge.
    switch (doc.type) {
      case DocumentType.SHEET:
        return { ...base, sheet: preview.sheet };
      case DocumentType.DOC:
      default:
        // Fail loud on both skew shapes: extraction failure (lexicalJson null) AND an old rtc-server that silently ignored include=render — it returns a lexicalJson WITHOUT materialized upload srcs and never emits the diffJson key (the render path always sets it, even as null).
        if (!preview.lexicalJson || preview.diffJson === undefined) {
          throw new HttpException({ error: "rtc service error" }, 502);
        }
        return {
          ...base,
          lexicalJson: preview.lexicalJson,
          diffJson: preview.diffJson,
        };
    }
  }

  // Read-only current-content preview for the search modal; gated identically to `get()`.
  async preview(userId: string, docId: string) {
    const doc = await this.get(userId, docId); // read gate + title/icon/breadcrumbs
    const p = await this.rtc.getHeadContent(docId);
    const base = {
      docId,
      type: doc.type,
      title: doc.title,
      icon: doc.icon,
      breadcrumbs: doc.breadcrumbs,
      updatedAt: doc.updatedAt,
      headSeq: p.headSeq,
    };
    return doc.type === DocumentType.SHEET
      ? { ...base, sheet: p.sheet }
      : { ...base, lexicalJson: p.lexicalJson, plainText: p.plainText };
  }

  // Content/metadata edit — any workspace EDITor (or the creator).
  async rename(userId: string, id: string, title: string) {
    const doc = await this.requireDocWrite(userId, id, "EDIT");
    const row = await this.writeThrough(
      this.prisma.document.update({
        where: { id },
        data: { title },
        select: this.summarySelect(),
      })
    );
    if (doc.parentId) this.cache.invalidateChildren(doc.parentId);
    this.events.documentUpdated(row.workspaceId, row);
    return row;
  }

  // Move within the workspace: parentId nests (clears folderId), folderId files, neither detaches to root.
  async move(userId: string, id: string, input: MoveDocumentInput) {
    const doc = await this.requireWorkspaceDocRole(userId, id, "EDIT");
    const oldParentId = doc.parentId;

    if (input.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException("a document cannot be its own parent");
      }
      await this.requireDocInWorkspace(input.parentId, doc.workspaceId);
      await this.assertNoDocCycle(id, input.parentId);
      const row = await this.writeThrough(
        this.prisma.document.update({
          where: { id },
          data: { parentId: input.parentId, folderId: null },
          select: this.summarySelect(),
        })
      );
      // The doc leaves one parent's child set and joins another — both snapshots are now stale.
      await this.invalidateChildSet(oldParentId);
      await this.invalidateChildSet(input.parentId);
      this.events.documentUpdated(row.workspaceId, row);
      return row;
    }

    if (input.folderId) {
      await this.requireFolderInWorkspace(input.folderId, doc.workspaceId);
      const row = await this.writeThrough(
        this.prisma.document.update({
          where: { id },
          data: { folderId: input.folderId, parentId: null },
          select: this.summarySelect(),
        })
      );
      await this.invalidateChildSet(oldParentId);
      this.events.documentUpdated(row.workspaceId, row);
      return row;
    }

    // Neither target → detach to the workspace root.
    const row = await this.writeThrough(
      this.prisma.document.update({
        where: { id },
        data: { folderId: null, parentId: null },
        select: this.summarySelect(),
      })
    );
    await this.invalidateChildSet(oldParentId);
    this.events.documentUpdated(row.workspaceId, row);
    return row;
  }

  // Star this document for the current user — anyone with read access can star.
  // Idempotent: upsert means re-starting an already-starred doc is a no-op, not an error.
  // Stars live outside the doc cache, so no cache work is needed here.
  async star(userId: string, id: string) {
    const { doc } = await this.requireDocRead(userId, id);
    await this.prisma.documentStar.upsert({
      where: { userId_documentId: { userId, documentId: id } },
      create: { userId, documentId: id },
      update: {},
    });
    return { ...doc, isStarred: true as const };
  }

  // Unstar — idempotent: deleteMany removes the row if present, no-ops otherwise.
  async unstar(userId: string, id: string) {
    await this.requireDocRead(userId, id);
    await this.prisma.documentStar.deleteMany({
      where: { userId, documentId: id },
    });
    return { ok: true as const };
  }

  // Delete — creator or workspace ADMIN only. Cascade-deletes the subdoc subtree; ids collected first to drop RTC rows.
  async remove(userId: string, id: string) {
    return trace("documents.remove", async () => {
      const doc = await this.requireWorkspaceDocRole(userId, id, "ADMIN");
      const ids = await this.collectSubtreeDocIds(doc.workspaceId, id);
      await this.prisma.document.delete({ where: { id } });
      for (const docId of ids) {
        this.cache.invalidate(docId);
        this.cache.invalidateChildren(docId);
      }
      await this.invalidateChildSet(doc.parentId);
      // Best-effort: an orphaned RTC row is inert, so a transient rtc-server outage is fine.
      for (const docId of ids) {
        void this.rtc.deleteDocBestEffort(docId);
      }
      // Announce the subtree root; subscribers drop it and its descendants from the side panel.
      this.events.documentDeleted(doc.workspaceId, id);
      return { ok: true as const, deleted: ids.length };
    });
  }

  // Active workspace from the session token, or an explicit override; 400 if neither.
  private resolveWorkspaceId(user: AuthUser, explicit?: string): string {
    const wsId = explicit ?? user.activeWorkspaceId;
    if (!wsId) {
      throw new BadRequestException(
        "no active workspace — enter a workspace first or pass workspaceId"
      );
    }
    return wsId;
  }

  // Write gate: effective doc role = MAX(workspace role, per-page grant); the owner writes on any footing, everyone else needs `min`.
  private async requireDocWrite(
    userId: string,
    id: string,
    min: "EDIT" | "ADMIN"
  ) {
    const doc = await this.loadDocRow(id);
    if (!doc) throw new NotFoundException("document not found");
    const [wsRole, grant] = await Promise.all([
      this.authz.effectiveWorkspaceRole(userId, doc.workspaceId),
      this.authz.docGrantRole(userId, id),
    ]);
    if (doc.owner.id === userId) {
      if (wsRole === null && grant === null) {
        throw new ForbiddenException("requires workspace role READ or higher");
      }
      return doc;
    }
    const effective = this.authz.maxWorkspaceRole(wsRole, grant);
    if (!this.authz.meetsWorkspaceRole(effective, min)) {
      throw new ForbiddenException(`requires workspace role ${min} or higher`);
    }
    return doc;
  }

  // Tree/lifecycle gate for move + delete: owner OR effective workspace role >= min. These ops act
  // on the doc's place in the workspace tree, so a per-page grant (doc-local, non-cascading) must
  // NOT authorize restructuring or deleting within someone else's workspace.
  private async requireWorkspaceDocRole(
    userId: string,
    id: string,
    min: "EDIT" | "ADMIN"
  ) {
    const doc = await this.loadDocRow(id);
    if (!doc) throw new NotFoundException("document not found");
    if (doc.owner.id === userId) return doc;
    const [wsRole, grant] = await Promise.all([
      this.authz.effectiveWorkspaceRole(userId, doc.workspaceId),
      this.authz.docGrantRole(userId, id),
    ]);
    if (this.authz.meetsWorkspaceRole(wsRole, min)) return doc;
    // No standing access at all → 404 (hide existence); readable but under-privileged → 403.
    if (wsRole === null && grant === null) throw new NotFoundException("document not found");
    throw new ForbiddenException(`requires workspace role ${min} or higher`);
  }

  // Target folder must exist in the same workspace as the document.
  private async requireFolderInWorkspace(folderId: string, workspaceId: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id: folderId, workspaceId },
      select: { id: true },
    });
    if (!folder) {
      throw new NotFoundException("folder not found in this workspace");
    }
    return folder;
  }

  // Parent document must exist in the same workspace (no cross-workspace nesting).
  private async requireDocInWorkspace(docId: string, workspaceId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, workspaceId },
      select: { id: true },
    });
    if (!doc) {
      throw new NotFoundException("parent document not found in this workspace");
    }
    return doc;
  }

  // Reject moving a document into its own subtree (walk parent→root looking for movingId).
  private async assertNoDocCycle(movingId: string, parentId: string) {
    let cursor: string | null = parentId;
    for (let i = 0; cursor !== null && i < MAX_DOC_DEPTH; i++) {
      if (cursor === movingId) {
        throw new BadRequestException(
          "cannot move a document into its own subtree"
        );
      }
      const node: { parentId: string | null } | null =
        await this.prisma.document.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = node?.parentId ?? null;
    }
  }

  // Ancestor id chain root → current; bounded by MAX_DOC_DEPTH + visited set so a corrupt chain can't loop.
  private async ancestorIds(id: string): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    for (let i = 0; cursor !== null && i < MAX_DOC_DEPTH; i++) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const node = await this.loadDocRow(cursor);
      if (!node) break;
      ids.push(cursor);
      cursor = node.parentId;
    }
    return ids.reverse();
  }

  // Direct children of `parentId` as collapsed hierarchy nodes (children: null).
  private async loadDirectChildren(parentId: string): Promise<HierarchyNode[]> {
    const cached = this.cache.getChildren(parentId) as HierarchyNode[] | undefined;
    if (cached) return cached;
    const rows = await this.prisma.document.findMany({
      where: { parentId },
      select: {
        id: true,
        title: true,
        icon: true,
        type: true,
        parentId: true,
        _count: { select: { children: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const children: HierarchyNode[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      type: r.type,
      parentId: r.parentId,
      childCount: r._count.children,
      isStarred: false, // placeholder; overlaid per-user in hierarchy()
      children: null,
    }));
    this.cache.setChildren(parentId, children);
    return children;
  }

  private async loadNodeMeta(ids: string[]) {
    const map = new Map<string, DocRow>();
    for (const id of ids) {
      const row = await this.loadDocRow(id);
      if (row) map.set(id, row);
    }
    return map;
  }

  // Assemble an expanded hierarchy node from its metadata + resolved children.
  private makeNode(
    meta: {
      id: string;
      title: string;
      icon: string | null;
      type: DocumentType;
      parentId: string | null;
    },
    children: HierarchyNode[]
  ): HierarchyNode {
    return {
      id: meta.id,
      title: meta.title,
      icon: meta.icon,
      type: meta.type,
      parentId: meta.parentId,
      childCount: children.length,
      isStarred: false, // placeholder; overlaid per-user in hierarchy()
      children,
    };
  }

  // --- Stars (per-user; deliberately kept out of the shared document cache) ---

  // Whether `userId` has starred this single document.
  private async isStarred(userId: string, documentId: string): Promise<boolean> {
    const star = await this.prisma.documentStar.findUnique({
      where: { userId_documentId: { userId, documentId } },
      select: { documentId: true },
    });
    return star !== null;
  }

  // Which of `documentIds` this user has starred — one query for a whole list/tree.
  private async starredIdSet(
    userId: string,
    documentIds: string[]
  ): Promise<Set<string>> {
    if (documentIds.length === 0) return new Set();
    const stars = await this.prisma.documentStar.findMany({
      where: { userId, documentId: { in: documentIds } },
      select: { documentId: true },
    });
    return new Set(stars.map((s) => s.documentId));
  }

  // Tag a batch of doc summaries with this user's isStarred flag (one query for all).
  private async attachStarred<T extends { id: string }>(
    userId: string,
    docs: T[]
  ): Promise<Array<T & { isStarred: boolean }>> {
    const starred = await this.starredIdSet(
      userId,
      docs.map((d) => d.id)
    );
    return docs.map((d) => ({ ...d, isStarred: starred.has(d.id) }));
  }

  // Per-request overlay (never cached — per-user): myRole = owner ? ADMIN : MAX(workspace role, per-page grant).
  private async attachMyRole<
    T extends { id: string; workspaceId: string; owner: { id: string } },
  >(
    userId: string,
    docs: T[],
    knownWsRoles?: ReadonlyMap<string, WorkspaceRole | null>
  ): Promise<Array<T & { myRole: WorkspaceRole | null }>> {
    if (docs.length === 0) return [];
    const grants = await this.prisma.documentPermission.findMany({
      where: { userId, documentId: { in: docs.map((d) => d.id) } },
      select: { documentId: true, role: true },
    });
    const grantByDoc = new Map(grants.map((g) => [g.documentId, g.role]));
    // One workspace-role lookup per distinct workspace, in parallel; callers pass roles they already hold.
    const wsRoleByWs = new Map<string, WorkspaceRole | null>(knownWsRoles ?? []);
    const missing = [...new Set(docs.map((d) => d.workspaceId))].filter(
      (wsId) => !wsRoleByWs.has(wsId)
    );
    await Promise.all(
      missing.map(async (wsId) =>
        wsRoleByWs.set(wsId, await this.authz.effectiveWorkspaceRole(userId, wsId))
      )
    );
    return docs.map((d) => ({
      ...d,
      myRole:
        d.owner.id === userId
          ? "ADMIN"
          : this.authz.maxWorkspaceRole(
              wsRoleByWs.get(d.workspaceId) ?? null,
              grantByDoc.get(d.id) ?? null
            ),
    }));
  }

  // Collect every node id in a hierarchy subtree (for a single batched star lookup).
  private collectNodeIds(node: HierarchyNode, acc: string[]): void {
    acc.push(node.id);
    if (node.children) {
      for (const child of node.children) this.collectNodeIds(child, acc);
    }
  }

  // Immutably rebuild the tree with each node's real isStarred — never mutates the
  // cached child nodes shared across users.
  private withStarred(
    node: HierarchyNode,
    starred: Set<string>
  ): HierarchyNode {
    return {
      ...node,
      isStarred: starred.has(node.id),
      children: node.children
        ? node.children.map((child) => this.withStarred(child, starred))
        : null,
    };
  }

  // All document ids in `rootId`'s subtree (inclusive), within one workspace.
  private async collectSubtreeDocIds(
    workspaceId: string,
    rootId: string
  ): Promise<string[]> {
    // Walk the subtree in the DB with a recursive CTE: one round trip returning just the
    // descendants, rather than loading every document in the workspace and walking it in
    // memory (which was O(workspace size) on each delete). The tree is workspace-scoped, so
    // anchoring the root to workspaceId already constrains the normal case; the recursive arm
    // re-asserts workspace_id as defense-in-depth, so a cross-workspace parent_id (raw DB write
    // or an unguarded reparent) can never leak a foreign doc into the deleted set.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree AS (
        SELECT id
        FROM documents
        WHERE id = ${rootId} AND workspace_id = ${workspaceId}
        UNION ALL
        SELECT d.id
        FROM documents d
        JOIN subtree s ON d.parent_id = s.id
        WHERE d.workspace_id = ${workspaceId}
      )
      SELECT id FROM subtree
    `;
    return rows.map((r) => r.id);
  }

  private summarySelect() {
    return SUMMARY_SELECT;
  }
}
