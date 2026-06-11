import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Visibility } from "@app/database";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { PaginationDto } from "../realm/dto";
import { DocumentsService } from "./documents.service";
import { RtcTokenService } from "../rtc/rtc-token.service";
import {
  CreateDocumentDto,
  ListDocumentsDto,
  MoveDocumentDto,
  RenameDocumentDto,
  SetVisibilityDto,
} from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("documents")
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly rtcTokens: RtcTokenService
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: ListDocumentsDto,
    @Query() page: PaginationDto
  ) {
    return this.documents.list(
      user,
      {
        folderId: q.folderId,
        // ?parentId=null (or empty) → top-level docs only; an id → that doc's children.
        parentId: parseParentId(q.parentId),
        workspaceId: q.workspaceId,
      },
      page.skip,
      page.take
    );
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.documents.create(user, dto);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.get(user.id, id);
  }

  /** Direct subdocs (immediate children) of a document. Requires READ on the parent. */
  @Get(":id/subdocs")
  subdocs(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query() page: PaginationDto
  ) {
    return this.documents.listSubdocs(user.id, id, page.skip, page.take);
  }

  /**
   * Sidebar hierarchy: the root ancestor expanded down the spine to this document,
   * with every node on the path listing its direct children. For building a tree
   * sidebar focused on the current document.
   */
  @Get(":id/hierarchy")
  hierarchy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.hierarchy(user.id, id);
  }

  /**
   * Issue a short-lived RTC token for this document. Resolves the caller's role
   * (editor/viewer) per current DB state; 403 if they have no access. The client
   * presents this token to the rtc-server WebSocket.
   */
  @Post(":id/rtc-token")
  async rtcToken(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const role = await this.documents.resolveRtcRole(user.id, id);
    const token = await this.rtcTokens.mint(user, id, role);
    return { token, docId: id, role };
  }

  @Patch(":id")
  rename(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: RenameDocumentDto
  ) {
    return this.documents.rename(user.id, id, dto.title);
  }

  @Patch(":id/move")
  move(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MoveDocumentDto
  ) {
    return this.documents.move(user.id, id, {
      folderId: dto.folderId ?? null,
      parentId: dto.parentId ?? null,
    });
  }

  @Patch(":id/visibility")
  setVisibility(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SetVisibilityDto
  ) {
    return this.documents.setVisibility(user.id, id, dto.visibility as Visibility);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.remove(user.id, id);
  }
}

/**
 * Map the `parentId` query string to the service's filter:
 *   - omitted        → undefined (no parent filter; whole workspace)
 *   - "" or "null"   → null      (top-level docs only)
 *   - "<id>"         → that id   (that document's direct subdocs)
 */
function parseParentId(raw?: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "null") return null;
  return raw;
}
