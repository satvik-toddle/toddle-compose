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
      { folderId: q.folderId, workspaceId: q.workspaceId },
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

  /** Per-author edit sessions (history timeline). Read access required. */
  @Get(":id/history")
  history(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.history(user.id, id);
  }

  /** Read-only snapshot of the document at a given update seq (sheet grid state). */
  @Get(":id/history/:seq")
  historyAt(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("seq") seq: string
  ) {
    return this.documents.historySnapshot(user.id, id, Number(seq));
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
    return this.documents.move(user.id, id, dto.folderId ?? null);
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
