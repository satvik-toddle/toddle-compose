import {
  BadRequestException,
  ForbiddenException,
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

// Bounds parent-chain walks so a corrupt folder.parentId cycle can't loop. Mirrors MAX_DOC_DEPTH.
const MAX_FOLDER_DEPTH = 256;

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly rtc: RtcInternalClient
  ) {}

  // Flat list of all workspace folders for client-side tree assembly (large take avoids dropping subtrees).
  // TODO(pagination): offset-based for now; switch to cursor-based for large workspaces.
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

  // Re-parent within the workspace (null → top level); rejects cross-workspace moves and cycles.
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

  // Soft-delete a folder and its live subtree (marked deletedAt, purged after ~30d); docs keep their folderId.
  async remove(userId: string, id: string) {
    const folder = await this.requireWritableFolder(userId, id);
    const ids = await this.collectLiveSubtreeIds(folder.workspaceId, id);
    const res = await this.prisma.folder.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true as const, softDeleted: res.count };
  }

  // Hard-delete folders soft-deleted > olderThanDays ago. Docs inside are deleted in the same tx —
  // Document.folderId is onDelete: SetNull, so otherwise they'd resurrect at the workspace root.
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

    for (const docId of docIds) {
      void this.rtc.deleteDocBestEffort(docId);
    }
    return purged;
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

  private async loadFolder(id: string): Promise<Folder> {
    const folder = await this.prisma.folder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!folder) throw new NotFoundException("folder not found");
    return folder;
  }

  // All live folder ids in `rootId`'s subtree (inclusive), within one workspace.
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

  // Write gate: the owner (needs current workspace READ) or a workspace ADMIN may mutate a folder.
  private async requireWritableFolder(
    userId: string,
    id: string
  ): Promise<Folder> {
    const folder = await this.loadFolder(id);
    if (folder.ownerId === userId) {
      await this.authz.requireWorkspaceRole(userId, folder.workspaceId, "READ");
      if (!this.authz.tokenAllowsWorkspaceRole("EDIT")) {
        throw new ForbiddenException("requires workspace role EDIT or higher");
      }
    } else {
      await this.authz.requireWorkspaceRole(userId, folder.workspaceId, "ADMIN");
    }
    return folder;
  }

  // Parent/target folder must exist in the same workspace (no cross-workspace nesting).
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

  // Reject moving a folder into its own subtree (walk parent→root looking for movingId).
  private async assertNoCycle(
    workspaceId: string,
    movingId: string,
    parentId: string
  ) {
    let cursor: string | null = parentId;
    for (let i = 0; cursor !== null && i < MAX_FOLDER_DEPTH; i++) {
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
