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
  ListStarredDocumentsDto,
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

  // The current user's starred documents in a workspace.
  // Declared before `:id` so "starred" isn't matched as a document id.
  @Get("starred")
  listStarred(
    @CurrentUser() user: AuthUser,
    @Query() q: ListStarredDocumentsDto,
    @Query() page: PaginationDto
  ) {
    return this.documents.listStarred(
      user,
      { workspaceId: q.workspaceId },
      page.skip,
      page.take
    );
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.get(user.id, id);
  }

  // Direct subdocs of a document; requires READ on the parent.
  @Get(":id/subdocs")
  subdocs(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query() page: PaginationDto
  ) {
    return this.documents.listSubdocs(user.id, id, page.skip, page.take);
  }

  // Sidebar hierarchy: root ancestor expanded down the spine to this document.
  @Get(":id/hierarchy")
  hierarchy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.hierarchy(user.id, id);
  }

  // Per-author edit sessions (history timeline); read access required.
  @Get(":id/history")
  history(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.history(user.id, id);
  }

  // Read-only snapshot of the document at a given update seq; ?diff=<baselineSeq> also returns the merged server-computed diff (DOC only, 0 = empty doc).
  @Get(":id/history/:seq")
  historyAt(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("seq") seq: string,
    @Query("diff") diff?: string
  ) {
    return this.documents.historySnapshot(
      user.id,
      id,
      Number(seq),
      diff != null && diff !== "" ? Number(diff) : undefined
    );
  }

  // Short-lived RTC token for this document; 403 if the caller has no access.
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

  // Star / unstar this document for the current user; both are idempotent.
  @Post(":id/star")
  star(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.star(user.id, id);
  }

  @Delete(":id/star")
  unstar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.unstar(user.id, id);
  }
}

// parentId query → filter: omitted=undefined (no filter), ""/"null"=null (top-level), id=that doc's subdocs.
function parseParentId(raw?: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "null") return null;
  return raw;
}
