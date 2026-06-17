import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Visibility, DocumentType } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { RtcRole } from "../rtc/rtc-token.service";
import type { AuthUser } from "../auth/current-user.decorator";

const OWNER_SELECT = { id: true, name: true, color: true } as const;

type CreateDocumentInput = {
  title?: string;
  icon?: string;
  type?: "DOC" | "SHEET";
  folderId?: string;
  // When set, folderId is ignored — a subdoc is located by its parent.
  parentId?: string;
  workspaceId?: string;
};

const DEFAULT_ICON: Record<DocumentType, string> = {
  [DocumentType.DOC]: "📄",
  [DocumentType.SHEET]: "📊",
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

type Breadcrumb = { id: string; title: string; icon: string };

// `children` is populated only for nodes on the expanded spine; off-path siblings get null + childCount.
type HierarchyNode = {
  id: string;
  title: string;
  icon: string;
  type: DocumentType;
  parentId: string | null;
  childCount: number;
  children: HierarchyNode[] | null;
};

// Bounds breadcrumb/ancestor walks so a corrupt self-referential chain can't loop.
const MAX_DOC_DEPTH = 256;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly rtc: RtcInternalClient
  ) {}

  // Documents in the (active or given) workspace, optionally narrowed to a folder.
  // TODO(pagination): offset-based for now; move to cursor-based once workspaces grow large (tracked in Coda).
  async list(
    user: AuthUser,
    input: ListDocumentsInput = {},
    skip = 0,
    take = 100
  ) {
    const wsId = this.resolveWorkspaceId(user, input.workspaceId);
    await this.authz.requireWorkspaceRole(user.id, wsId, "READ");

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

    return this.prisma.document.findMany({
      where: { workspaceId: wsId, ...folderScope, ...parentScope },
      select: this.summarySelect(),
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    });
  }

  // Direct subdocs of a document; workspace READ on the parent gates the whole list.
  async listSubdocs(userId: string, parentId: string, skip = 0, take = 100) {
    const parent = await this.requireDocRead(userId, parentId);
    return this.prisma.document.findMany({
      where: { parentId: parent.id },
      select: this.summarySelect(),
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    });
  }

  // Sidebar hierarchy: root ancestor expanded down the spine, each on-path node listing its children.
  // Gated to workspace members/owner: unlike GET /:id, a PUBLIC-only realm viewer gets 404.
  async hierarchy(userId: string, id: string): Promise<HierarchyNode> {
    const doc = await this.requireDocRead(userId, id);
    if (doc.owner.id !== userId) {
      const role = await this.authz.effectiveWorkspaceRole(userId, doc.workspaceId);
      if (role === null) throw new NotFoundException("document not found");
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
    return built;
  }

  async create(user: AuthUser, input: CreateDocumentInput) {
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
        icon: input.icon ?? DEFAULT_ICON[type],
        type,
        workspaceId: wsId,
        ownerId: user.id,
        parentId: input.parentId ?? null,
        folderId: input.parentId ? null : (input.folderId ?? null),
        visibility: Visibility.PRIVATE,
      },
      select: this.summarySelect(),
    });
    // Best-effort RTC provisioning: the rtc-server also creates the row lazily on first connect.
    await this.rtc.initDocBestEffort(doc.id);
    return doc;
  }

  // RTC role for the token: editor for owner/EDIT+, viewer for READ/COMMENT or PUBLIC; 404/403 when no access.
  async resolveRtcRole(userId: string, docId: string): Promise<RtcRole> {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: { id: true, ownerId: true, workspaceId: true, visibility: true },
    });
    if (!doc) throw new NotFoundException("document not found");

    if (doc.ownerId === userId) return "editor";

    const role = await this.authz.effectiveWorkspaceRole(userId, doc.workspaceId);
    if (role === "ADMIN" || role === "EDIT") return "editor";
    if (role === "READ" || role === "COMMENT") return "viewer";

    if (
      doc.visibility === Visibility.PUBLIC &&
      (await this.authz.realmRole(userId)) !== null
    ) {
      return "viewer";
    }
    throw new ForbiddenException("no access to this document");
  }

  // Read a document plus its ancestor breadcrumbs; the collaborative body lives in the rtc-database, not here.
  async get(userId: string, id: string) {
    const doc = await this.requireDocRead(userId, id);
    const breadcrumbs = await this.buildBreadcrumbs(doc.id);
    return { ...doc, breadcrumbs };
  }

  // Read gate shared by `get`/`listSubdocs`; 404 (not 403) so a hidden doc's existence isn't revealed.
  private async requireDocRead(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: this.summarySelect(),
    });
    if (!doc) throw new NotFoundException("document not found");

    if (doc.owner.id === userId) return doc;

    const role = await this.authz.effectiveWorkspaceRole(userId, doc.workspaceId);
    if (role !== null) return doc;

    if (
      doc.visibility === Visibility.PUBLIC &&
      (await this.authz.realmRole(userId)) !== null
    ) {
      return doc;
    }

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
      const node: (Breadcrumb & { parentId: string | null }) | null =
        await this.prisma.document.findUnique({
          where: { id: cursor },
          select: { id: true, title: true, icon: true, parentId: true },
        });
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
          origin: s.origin,
          changedCells: s.changedCells ?? [],
          user: s.clientSub ? (byId.get(s.clientSub) ?? null) : null,
        }))
        .reverse(), // newest first
    };
  }

  // Read-only preview of the document at a given seq; the kind is resolved from the doc, then dispatched on.
  async historySnapshot(userId: string, docId: string, seq: number) {
    const doc = await this.get(userId, docId);
    if (!Number.isFinite(seq) || seq < 0) {
      throw new BadRequestException("seq must be a non-negative integer");
    }
    const preview = await this.rtc.getVersionPreview(docId, seq);
    const base = { docId, type: doc.type, seq: preview.seq, headSeq: preview.headSeq };

    // Seam where DOC and SHEET data diverge.
    switch (doc.type) {
      case DocumentType.SHEET:
        return { ...base, sheet: preview.sheet };
      case DocumentType.DOC:
      default:
        return {
          ...base,
          lexicalJson: preview.lexicalJson,
          plainText: preview.plainText,
        };
    }
  }

  // Content/metadata edit — any workspace EDITor (or the creator).
  async rename(userId: string, id: string, title: string) {
    await this.requireDocWrite(userId, id, "EDIT");
    return this.prisma.document.update({
      where: { id },
      data: { title },
      select: this.summarySelect(),
    });
  }

  // Move within the workspace: parentId nests (clears folderId), folderId files, neither detaches to root.
  async move(userId: string, id: string, input: MoveDocumentInput) {
    const doc = await this.requireDocWrite(userId, id, "EDIT");

    if (input.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException("a document cannot be its own parent");
      }
      await this.requireDocInWorkspace(input.parentId, doc.workspaceId);
      await this.assertNoDocCycle(id, input.parentId);
      return this.prisma.document.update({
        where: { id },
        data: { parentId: input.parentId, folderId: null },
        select: this.summarySelect(),
      });
    }

    if (input.folderId) {
      await this.requireFolderInWorkspace(input.folderId, doc.workspaceId);
      return this.prisma.document.update({
        where: { id },
        data: { folderId: input.folderId, parentId: null },
        select: this.summarySelect(),
      });
    }

    // Neither target → detach to the workspace root.
    return this.prisma.document.update({
      where: { id },
      data: { folderId: null, parentId: null },
      select: this.summarySelect(),
    });
  }

  // Public/private toggle — creator or workspace ADMIN only.
  async setVisibility(userId: string, id: string, visibility: Visibility) {
    await this.requireDocWrite(userId, id, "ADMIN");
    return this.prisma.document.update({
      where: { id },
      data: { visibility },
      select: this.summarySelect(),
    });
  }

  // Delete — creator or workspace ADMIN only. Cascade-deletes the subdoc subtree; ids collected first to drop RTC rows.
  async remove(userId: string, id: string) {
    const doc = await this.requireDocWrite(userId, id, "ADMIN");
    const ids = await this.collectSubtreeDocIds(doc.workspaceId, id);
    await this.prisma.document.delete({ where: { id } });
    // Best-effort: an orphaned RTC row is inert, so a transient rtc-server outage is fine.
    for (const docId of ids) {
      await this.rtc.deleteDocBestEffort(docId);
    }
    return { ok: true as const, deleted: ids.length };
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

  // Write gate: the owner needs only workspace READ; everyone else needs at least `min` (EDIT or ADMIN).
  private async requireDocWrite(
    userId: string,
    id: string,
    min: "EDIT" | "ADMIN"
  ) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, ownerId: true, workspaceId: true },
    });
    if (!doc) throw new NotFoundException("document not found");
    if (doc.ownerId === userId) {
      await this.authz.requireWorkspaceRole(userId, doc.workspaceId, "READ");
    } else {
      await this.authz.requireWorkspaceRole(userId, doc.workspaceId, min);
    }
    return doc;
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
      const node: { parentId: string | null } | null =
        await this.prisma.document.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      if (!node) break;
      ids.push(cursor);
      cursor = node.parentId;
    }
    return ids.reverse();
  }

  // Direct children of `parentId` as collapsed hierarchy nodes (children: null).
  private async loadDirectChildren(parentId: string): Promise<HierarchyNode[]> {
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
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      type: r.type,
      parentId: r.parentId,
      childCount: r._count.children,
      children: null,
    }));
  }

  // Metadata (+ direct child count) for a set of document ids, keyed by id.
  private async loadNodeMeta(ids: string[]) {
    const rows = await this.prisma.document.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        icon: true,
        type: true,
        parentId: true,
        _count: { select: { children: true } },
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  // Assemble an expanded hierarchy node from its metadata + resolved children.
  private makeNode(
    meta: {
      id: string;
      title: string;
      icon: string;
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
      children,
    };
  }

  // All document ids in `rootId`'s subtree (inclusive), within one workspace.
  private async collectSubtreeDocIds(
    workspaceId: string,
    rootId: string
  ): Promise<string[]> {
    const all = await this.prisma.document.findMany({
      where: { workspaceId },
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const d of all) {
      if (!d.parentId) continue;
      const arr = childrenByParent.get(d.parentId) ?? [];
      arr.push(d.id);
      childrenByParent.set(d.parentId, arr);
    }
    const ids: string[] = [];
    const stack = [rootId];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      ids.push(cur);
      for (const child of childrenByParent.get(cur) ?? []) stack.push(child);
    }
    return ids;
  }

  private summarySelect() {
    return {
      id: true,
      title: true,
      icon: true,
      type: true,
      visibility: true,
      workspaceId: true,
      folderId: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: OWNER_SELECT },
    } as const;
  }
}
