import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Folder } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { AuthUser } from "../auth/current-user.decorator";

type CreateFolderInput = {
  name: string;
  icon?: string;
  parentId?: string;
  workspaceId?: string;
};
type UpdateFolderInput = { name?: string; icon?: string };

/**
 * Folders live inside a workspace. Read access follows workspace READ — so every
 * workspace member, the workspace ADMIN, and (via the AuthzService overlay) the
 * realm OWNER/MAINTAINER all see them. Creating requires EDIT; renaming / moving /
 * deleting requires being the creator or a workspace ADMIN.
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly rtc: RtcInternalClient
  ) {}

  /**
   * All folders in the (active or given) workspace; flat, for client-side tree assembly.
   * The default/max `take` of 2000 is deliberately large (see ListFoldersDto): a
   * truncated flat list would silently drop whole subtrees on the client.
   * TODO(pagination): currently offset-based (skip/take). For large workspaces switch to
   * cursor-based pagination (e.g. `cursor` = last folder id + `take`) and return a
   * `{ items, nextCursor, total }` envelope so the tree can load incrementally.
   */
  async list(
    user: AuthUser,
    workspaceId: string | undefined,
    skip = 0,
    take = 2000
  ) {
    const wsId = this.resolveWorkspaceId(user, workspaceId);
    await this.authz.requireWorkspaceRole(user.id, wsId, "READ");
    return this.prisma.folder.findMany({
      where: { workspaceId: wsId, deletedAt: null },
      orderBy: [{ parentId: "asc" }, { createdAt: "asc" }],
      skip,
      take,
    });
  }

  async create(user: AuthUser, input: CreateFolderInput) {
    const wsId = this.resolveWorkspaceId(user, input.workspaceId);
    await this.authz.requireWorkspaceRole(user.id, wsId, "EDIT");
    if (input.parentId) await this.requireFolderInWorkspace(input.parentId, wsId);
    return this.prisma.folder.create({
      data: {
        name: input.name,
        icon: input.icon,
        workspaceId: wsId,
        ownerId: user.id,
        parentId: input.parentId ?? null,
      },
    });
  }

  async get(userId: string, id: string) {
    const folder = await this.loadFolder(id);
    await this.authz.requireWorkspaceRole(userId, folder.workspaceId, "READ");
    return folder;
  }

  async update(userId: string, id: string, patch: UpdateFolderInput) {
    await this.requireWritableFolder(userId, id);
    return this.prisma.folder.update({
      where: { id },
      data: { name: patch.name, icon: patch.icon },
    });
  }

  /** Re-parent within the same workspace (null → top level). Rejects cross-workspace moves and cycles. */
  async move(userId: string, id: string, parentId: string | null) {
    const folder = await this.requireWritableFolder(userId, id);

    if (parentId) {
      if (parentId === id) {
        throw new BadRequestException("a folder cannot be its own parent");
      }
      await this.requireFolderInWorkspace(parentId, folder.workspaceId);
      await this.assertNoCycle(folder.workspaceId, id, parentId);
    }

    return this.prisma.folder.update({
      where: { id },
      data: { parentId: parentId ?? null },
    });
  }

  /**
   * Soft-delete a folder and its entire (live) subtree: rows are marked deletedAt
   * and hidden from every read, then hard-purged after ~30 days by the scheduler.
   * Documents keep their folderId; they simply no longer surface under a hidden folder.
   */
  async remove(userId: string, id: string) {
    const folder = await this.requireWritableFolder(userId, id);
    const ids = await this.collectLiveSubtreeIds(folder.workspaceId, id);
    const res = await this.prisma.folder.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true as const, softDeleted: res.count };
  }

  /**
   * Hard-delete folders soft-deleted longer than `olderThanDays` ago. Called by the
   * daily purge scheduler; safe to run anytime. Returns the number removed.
   *
   * Documents inside purged folders are hard-deleted in the same transaction:
   * Document.folderId is `onDelete: SetNull`, so without this the docs would
   * "resurrect" at the workspace root once their folder row disappears.
   */
  async purgeSoftDeleted(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const { purged, docIds } = await this.prisma.$transaction(async (tx) => {
      const expired = await tx.folder.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        select: { id: true },
      });
      if (expired.length === 0) return { purged: 0, docIds: [] as string[] };
      const folderIds = expired.map((f) => f.id);

      const docs = await tx.document.findMany({
        where: { folderId: { in: folderIds } },
        select: { id: true },
      });
      await tx.document.deleteMany({
        where: { id: { in: docs.map((d) => d.id) } },
      });
      const res = await tx.folder.deleteMany({ where: { id: { in: folderIds } } });
      return { purged: res.count, docIds: docs.map((d) => d.id) };
    });

    // After commit: drop the deleted documents' RTC rows (separate DB). Best-effort —
    // an orphaned RTC row is inert, so a transient rtc-server outage is harmless.
    for (const docId of docIds) {
      await this.rtc.deleteDocBestEffort(docId);
    }
    return purged;
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

  private async loadFolder(id: string): Promise<Folder> {
    const folder = await this.prisma.folder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!folder) throw new NotFoundException("folder not found");
    return folder;
  }

  /** All live folder ids in `rootId`'s subtree (inclusive), within one workspace. */
  private async collectLiveSubtreeIds(
    workspaceId: string,
    rootId: string
  ): Promise<string[]> {
    const all = await this.prisma.folder.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const f of all) {
      if (!f.parentId) continue;
      const arr = childrenByParent.get(f.parentId) ?? [];
      arr.push(f.id);
      childrenByParent.set(f.parentId, arr);
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

  /**
   * Write gate: the creator (owner) or a workspace ADMIN may mutate a folder.
   * The owner still needs current READ on the workspace (roles are per-request).
   */
  private async requireWritableFolder(
    userId: string,
    id: string
  ): Promise<Folder> {
    const folder = await this.loadFolder(id);
    if (folder.ownerId === userId) {
      await this.authz.requireWorkspaceRole(userId, folder.workspaceId, "READ");
    } else {
      await this.authz.requireWorkspaceRole(userId, folder.workspaceId, "ADMIN");
    }
    return folder;
  }

  /** Parent/target folder must exist in the same workspace (no cross-workspace nesting). */
  private async requireFolderInWorkspace(folderId: string, workspaceId: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id: folderId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) {
      throw new NotFoundException("parent folder not found in this workspace");
    }
    return folder;
  }

  /**
   * Walk up from the proposed parent to the root; reaching the folder being moved
   * means the move would create a cycle. Scoped to the workspace.
   */
  private async assertNoCycle(
    workspaceId: string,
    movingId: string,
    parentId: string
  ) {
    let cursor: string | null = parentId;
    while (cursor !== null) {
      if (cursor === movingId) {
        throw new BadRequestException("cannot move a folder into its own subtree");
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.folder.findFirst({
          where: { id: cursor, workspaceId, deletedAt: null },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }
}
