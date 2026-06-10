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
  workspaceId?: string;
};

// Default icon per document kind when the caller doesn't pass one.
const DEFAULT_ICON: Record<DocumentType, string> = {
  [DocumentType.DOC]: "📄",
  [DocumentType.SHEET]: "📊",
};
type ListDocumentsInput = { folderId?: string; workspaceId?: string };

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

    const folderScope =
      input.folderId === undefined ? {} : { folderId: input.folderId };

    return this.prisma.document.findMany({
      where: { workspaceId: wsId, ...folderScope },
      select: this.summarySelect(),
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    });
  }

  async create(user: AuthUser, input: CreateDocumentInput) {
    const wsId = this.resolveWorkspaceId(user, input.workspaceId);
    await this.authz.requireWorkspaceRole(user.id, wsId, "EDIT");
    if (input.folderId) await this.requireFolderInWorkspace(input.folderId, wsId);
    const type = (input.type as DocumentType) ?? DocumentType.DOC;
    const doc = await this.prisma.document.create({
      data: {
        title: input.title,
        icon: input.icon ?? DEFAULT_ICON[type],
        type,
        workspaceId: wsId,
        ownerId: user.id,
        folderId: input.folderId ?? null,
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
   * Read a document. Allowed for: the creator, anyone with workspace access
   * (READ+, incl. realm overlay), or — when PUBLIC — any realm member.
   */
  async get(userId: string, id: string) {
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

    // Don't reveal the existence of a document the caller can't see.
    throw new NotFoundException("document not found");
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

  /** Move within the same workspace; to the root (null) or into a folder of that workspace. */
  async move(userId: string, id: string, folderId: string | null) {
    const doc = await this.requireDocWrite(userId, id, "EDIT");
    if (folderId) await this.requireFolderInWorkspace(folderId, doc.workspaceId);
    return this.prisma.document.update({
      where: { id },
      data: { folderId: folderId ?? null },
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

  /** Delete — sensitive: creator or workspace ADMIN only. */
  async remove(userId: string, id: string) {
    await this.requireDocWrite(userId, id, "ADMIN");
    await this.prisma.document.delete({ where: { id } });
    return { ok: true as const };
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

  private summarySelect() {
    return {
      id: true,
      title: true,
      icon: true,
      type: true,
      visibility: true,
      workspaceId: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: OWNER_SELECT },
    } as const;
  }
}
