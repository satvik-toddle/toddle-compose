import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Visibility } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { RtcRole } from "../rtc/rtc-token.service";
import type { AuthUser } from "../auth/current-user.decorator";

const OWNER_SELECT = { id: true, name: true, color: true } as const;

type CreateDocumentInput = {
  title?: string;
  icon?: string;
  folderId?: string;
  // Nest the new document under an existing document (a "subdoc") of the same
  // workspace. When set, folderId is ignored — a subdoc is located by its parent.
  parentId?: string;
  workspaceId?: string;
};
type ListDocumentsInput = {
  folderId?: string;
  // null → only top-level (no parent) docs; a string → that parent's direct children.
  parentId?: string | null;
  workspaceId?: string;
};
type MoveDocumentInput = {
  // Move into a folder (omit/null → workspace root). Mutually exclusive with parentId.
  folderId?: string | null;
  // Re-parent under another document (omit/null → detach from parent). Wins over folderId.
  parentId?: string | null;
};

/** One hop in a document's ancestor chain, root → current (current is last). */
type Breadcrumb = { id: string; title: string; icon: string };

/**
 * A node in the sidebar hierarchy. `children` is populated only for nodes on the
 * path from the root ancestor down to the target document (the expanded "spine");
 * for off-path siblings it is null and `childCount` tells the UI whether to show an
 * expand affordance.
 */
type HierarchyNode = {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  childCount: number;
  children: HierarchyNode[] | null;
};

// Guards against a pathological self-referential chain in the DB (FK + cycle
// checks prevent it, but breadcrumb/ancestor walks stay bounded regardless).
const MAX_DOC_DEPTH = 256;

/**
 * Documents live inside a workspace. Read access follows workspace READ (members +
 * workspace ADMIN + the realm OWNER/MAINTAINER overlay); a PUBLIC document is
 * additionally readable by any realm member across workspaces. Creating requires
 * EDIT; renaming / moving / deleting / changing visibility requires being the
 * creator or a workspace ADMIN.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly rtc: RtcInternalClient
  ) {}

  /**
   * Documents in the (active or given) workspace, optionally narrowed to a folder.
   * TODO(pagination): offset-based (skip/take) for now. Move to cursor-based pagination
   * (cursor = last doc id, ordered by updatedAt) returning `{ items, nextCursor, total }`
   * once workspaces hold many documents. Tracked in Coda (see the pagination row).
   */
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

    // A parent filter narrows to one document's direct subdocs; `null` → top-level
    // docs only (no parent). The parent must live in this workspace (404 otherwise).
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

  /**
   * Direct subdocs of a document (its immediate children). The caller must be able
   * to READ the parent; children share the parent's workspace, so workspace READ on
   * the parent's workspace gates the whole list.
   */
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

  /**
   * Sidebar hierarchy for a document: the root ancestor expanded down the spine to
   * this document. Every node on the path lists ALL its direct children; the child
   * that continues the path is itself expanded, the rest are collapsed (children:
   * null, with childCount for an expand chevron). For a doc at p1 → c2 → c3 this
   * yields p1 + its children → (c2 expanded) + its children → (c3 expanded) + its
   * children.
   *
   * Gated to workspace members (or the owner): unlike GET /:id, a PUBLIC-only realm
   * viewer who isn't in the workspace gets 404 — the sidebar is a workspace view.
   */
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

    // Build bottom-up: start at the current doc (expanded), then graft each level
    // onto its parent, replacing the collapsed on-path child with the expanded one.
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

    // A subdoc is located by its parent, not a folder: parentId wins over folderId.
    if (input.parentId) await this.requireDocInWorkspace(input.parentId, wsId);
    else if (input.folderId)
      await this.requireFolderInWorkspace(input.folderId, wsId);

    const doc = await this.prisma.document.create({
      data: {
        title: input.title,
        icon: input.icon,
        workspaceId: wsId,
        ownerId: user.id,
        parentId: input.parentId ?? null,
        folderId: input.parentId ? null : (input.folderId ?? null),
        // PRIVATE-by-default is also the schema default; set explicitly for clarity.
        visibility: Visibility.PRIVATE,
      },
      select: this.summarySelect(),
    });
    // Eagerly provision the RTC row (separate DB). Best-effort: the rtc-server also
    // lazily creates it on first WS connect, so a transient outage is harmless.
    await this.rtc.initDocBestEffort(doc.id);
    return doc;
  }

  /**
   * Decide what the caller may do over RTC and return the role to bake into the
   * token: 'editor' for owner / workspace EDIT+; 'viewer' for workspace READ/COMMENT
   * or a PUBLIC doc readable by any realm member. Throws 404/403 when no access —
   * the backend never mints a 'denied' token.
   */
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

  /**
   * Read a document plus its ancestor breadcrumbs (root → this doc, this doc last).
   * Allowed for: the creator, anyone with workspace access (READ+, incl. realm
   * overlay), or — when PUBLIC — any realm member. The collaborative body itself
   * lives in the rtc-database and is fetched over the RTC websocket, not here.
   */
  async get(userId: string, id: string) {
    const doc = await this.requireDocRead(userId, id);
    const breadcrumbs = await this.buildBreadcrumbs(doc.id);
    return { ...doc, breadcrumbs };
  }

  /**
   * Read gate shared by `get` and `listSubdocs`. Returns the (summary-shaped)
   * document when the caller may read it, else 404 — we never reveal the existence
   * of a document the caller can't see.
   */
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

  /**
   * Walk parent links from `id` up to the root, returning the chain root → current
   * (current doc last). Bounded by MAX_DOC_DEPTH and a visited set so a corrupt
   * chain can never loop. Used to render the document's location breadcrumb.
   */
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

  /** Content/metadata edits (rename, move) — any workspace EDITor (or the creator). */
  async rename(userId: string, id: string, title: string) {
    await this.requireDocWrite(userId, id, "EDIT");
    return this.prisma.document.update({
      where: { id },
      data: { title },
      select: this.summarySelect(),
    });
  }

  /**
   * Move within the same workspace. Two mutually exclusive targets:
   *   - parentId → nest under another document (a subdoc); clears folderId.
   *   - folderId → place in a folder; clears parentId.
   * Both null/omitted → detach to the workspace root. Re-parenting rejects cycles
   * (a document cannot be moved into its own subtree) and self-parenting.
   */
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

  /** Public/private toggle — sensitive: creator or workspace ADMIN only. */
  async setVisibility(userId: string, id: string, visibility: Visibility) {
    await this.requireDocWrite(userId, id, "ADMIN");
    return this.prisma.document.update({
      where: { id },
      data: { visibility },
      select: this.summarySelect(),
    });
  }

  /**
   * Delete — sensitive: creator or workspace ADMIN only. Deleting a document
   * cascade-deletes its entire subdoc subtree (FK onDelete: Cascade). We collect the
   * descendant ids first so we can drop each one's RTC row (separate DB) after.
   */
  async remove(userId: string, id: string) {
    const doc = await this.requireDocWrite(userId, id, "ADMIN");
    const ids = await this.collectSubtreeDocIds(doc.workspaceId, id);
    await this.prisma.document.delete({ where: { id } });
    // Drop the RTC rows (separate DB) for the doc and every cascaded subdoc.
    // Best-effort: an orphaned row is inert, so a transient rtc-server outage is fine.
    for (const docId of ids) {
      await this.rtc.deleteDocBestEffort(docId);
    }
    return { ok: true as const, deleted: ids.length };
  }

  /** Active workspace from the session token, or an explicit override; 400 if neither. */
  private resolveWorkspaceId(user: AuthUser, explicit?: string): string {
    const wsId = explicit ?? user.activeWorkspaceId;
    if (!wsId) {
      throw new BadRequestException(
        "no active workspace — enter a workspace first or pass workspaceId"
      );
    }
    return wsId;
  }

  /**
   * Write gate. The creator (owner) may always write their own document (subject to
   * still having READ on the workspace); anyone else needs at least `min` on the
   * document's workspace — EDIT for content/metadata, ADMIN for visibility/delete.
   */
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

  /** Target folder must exist in the same workspace as the document. */
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

  /** Parent document must exist in the same workspace (no cross-workspace nesting). */
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

  /**
   * Walk up from the proposed parent to the root; reaching the document being moved
   * means the move would nest it inside its own subtree. Scoped to the workspace and
   * bounded by MAX_DOC_DEPTH.
   */
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

  /**
   * Ancestor id chain for `id`, ordered root → current (current last). Bounded by
   * MAX_DOC_DEPTH and a visited set so a corrupt chain can never loop.
   */
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

  /** Direct children of `parentId` as collapsed hierarchy nodes (children: null). */
  private async loadDirectChildren(parentId: string): Promise<HierarchyNode[]> {
    const rows = await this.prisma.document.findMany({
      where: { parentId },
      select: {
        id: true,
        title: true,
        icon: true,
        parentId: true,
        _count: { select: { children: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      parentId: r.parentId,
      childCount: r._count.children,
      children: null,
    }));
  }

  /** Metadata (+ direct child count) for a set of document ids, keyed by id. */
  private async loadNodeMeta(ids: string[]) {
    const rows = await this.prisma.document.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        icon: true,
        parentId: true,
        _count: { select: { children: true } },
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Assemble an expanded hierarchy node from its metadata + resolved children. */
  private makeNode(
    meta: { id: string; title: string; icon: string; parentId: string | null },
    children: HierarchyNode[]
  ): HierarchyNode {
    return {
      id: meta.id,
      title: meta.title,
      icon: meta.icon,
      parentId: meta.parentId,
      childCount: children.length,
      children,
    };
  }

  /** All document ids in `rootId`'s subtree (inclusive), within one workspace. */
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
