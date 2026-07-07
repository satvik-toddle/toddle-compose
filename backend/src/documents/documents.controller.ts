import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { PaginationDto } from "../realm/dto";
import { DocumentsService } from "./documents.service";
import { DocumentPermissionsService } from "./document-permissions.service";
import { DocumentShareLinksService } from "./document-share-links.service";
import { RtcTokenService } from "../rtc/rtc-token.service";
import {
  AddDocumentPermissionDto,
  CreateDocumentDto,
  ListDocumentsDto,
  ListStarredDocumentsDto,
  MoveDocumentDto,
  RenameDocumentDto,
  UpdateDocumentPermissionDto,
  UpsertShareLinkDto,
} from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("documents")
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly permissions: DocumentPermissionsService,
    private readonly shareLinks: DocumentShareLinksService,
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

  // Global "Shared with me" across all workspaces (launcher side panel).
  // Declared before `:id` so "shared-with-me" isn't matched as a document id.
  @Get("shared-with-me")
  listAllShared(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.documents.listAllSharedWithMe(user, page.skip, page.take);
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

  // Read-only snapshot of the document at a given update seq.
  @Get(":id/history/:seq")
  historyAt(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("seq") seq: string
  ) {
    return this.documents.historySnapshot(user.id, id, Number(seq));
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

  // --- Per-page permission grants (manage from the doc's 3-dots → Permissions) ---

  // Explicit grants on this doc; requires manage rights (owner / workspace ADMIN / doc-ADMIN grantee).
  @Get(":id/permissions")
  listPermissions(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.permissions.list(user.id, id);
  }

  // Grant a registered user any role on this doc (elevate-only); 404 unregistered email, 409 owner/duplicate.
  @Post(":id/permissions")
  addPermission(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AddDocumentPermissionDto
  ) {
    return this.permissions.add(user, id, dto.email, dto.role);
  }

  // Change a grant's role; 404 if there's no grant for that user.
  @Patch(":id/permissions/:userId")
  updatePermission(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() dto: UpdateDocumentPermissionDto
  ) {
    return this.permissions.update(user.id, id, userId, dto.role);
  }

  // Revoke a grant; allowed for managers or the grantee themselves (leave the page).
  @Delete(":id/permissions/:userId")
  removePermission(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") userId: string
  ) {
    return this.permissions.remove(user.id, id, userId);
  }

  // ------------------------------------------------------------ share link (manage)

  @Get(":id/share-link")
  getShareLink(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.shareLinks.get(user.id, id);
  }

  @Put(":id/share-link")
  upsertShareLink(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpsertShareLinkDto
  ) {
    return this.shareLinks.upsert(user.id, id, dto.role, dto.scope);
  }

  @Post(":id/share-link/regenerate")
  regenerateShareLink(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.shareLinks.regenerate(user.id, id);
  }

  @Delete(":id/share-link")
  removeShareLink(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.shareLinks.remove(user.id, id);
  }

  // Force everyone currently in the doc to re-check access now (kick live RTC + invalidate tokens).
  @Post(":id/refresh-access")
  refreshAccess(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.shareLinks.refreshAccess(user.id, id);
  }

}

// parentId query → filter: omitted=undefined (no filter), ""/"null"=null (top-level), id=that doc's subdocs.
function parseParentId(raw?: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "null") return null;
  return raw;
}
