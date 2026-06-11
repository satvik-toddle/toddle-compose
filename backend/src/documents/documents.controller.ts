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
import { Visibility, DocumentType } from "@app/database";
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

/**
 * Documents and Sheets are the SAME resource (a `Document` with a `type`), served
 * by two kind-scoped namespaces:
 *   - DocumentsController  /api/documents → DOC
 *   - SheetsController     /api/sheets    → SHEET
 * Every per-id route passes its `kind` to the service, which 404s if the addressed
 * document is the other kind (you cannot reach a SHEET via /documents, or vice
 * versa). Both controllers delegate to one DocumentsService — only `kind` differs.
 * The two thin controllers below are intentionally near-identical; the enforcement
 * and all logic live in the service, keyed by `kind`.
 */
abstract class BaseDocumentsController {
  protected abstract readonly kind: DocumentType;

  constructor(
    protected readonly documents: DocumentsService,
    protected readonly rtcTokens: RtcTokenService
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
        type: this.kind,
        workspaceId: q.workspaceId,
      },
      page.skip,
      page.take
    );
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    // Kind comes from the namespace, never the body.
    return this.documents.create(user, { ...dto, type: this.kind });
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.get(user.id, id, this.kind);
  }

  /** Direct subdocs (immediate children) of this document. Requires READ on it. */
  @Get(":id/subdocs")
  subdocs(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query() page: PaginationDto
  ) {
    return this.documents.listSubdocs(user.id, id, page.skip, page.take, this.kind);
  }

  /**
   * Sidebar hierarchy: the root ancestor expanded down the spine to this document,
   * with every node on the path listing its direct children.
   */
  @Get(":id/hierarchy")
  hierarchy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.hierarchy(user.id, id, this.kind);
  }

  /** Per-author edit sessions (history timeline). Read access required. */
  @Get(":id/history")
  history(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.history(user.id, id, this.kind);
  }

  /** Read-only snapshot of the document at a given update seq (sheet grid state). */
  @Get(":id/history/:seq")
  historyAt(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("seq") seq: string
  ) {
    return this.documents.historySnapshot(user.id, id, Number(seq), this.kind);
  }

  /**
   * Issue a short-lived RTC token for this document. Resolves the caller's role
   * (editor/viewer) per current DB state; 403 if no access. The client presents
   * this token to the rtc-server WebSocket.
   */
  @Post(":id/rtc-token")
  async rtcToken(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const role = await this.documents.resolveRtcRole(user.id, id, this.kind);
    const token = await this.rtcTokens.mint(user, id, role);
    return { token, docId: id, role };
  }

  @Patch(":id")
  rename(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: RenameDocumentDto
  ) {
    return this.documents.rename(user.id, id, dto.title, this.kind);
  }

  @Patch(":id/move")
  move(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MoveDocumentDto
  ) {
    return this.documents.move(
      user.id,
      id,
      { folderId: dto.folderId ?? null, parentId: dto.parentId ?? null },
      this.kind
    );
  }

  @Patch(":id/visibility")
  setVisibility(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SetVisibilityDto
  ) {
    return this.documents.setVisibility(
      user.id,
      id,
      dto.visibility as Visibility,
      this.kind
    );
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.remove(user.id, id, this.kind);
  }
}

@UseGuards(JwtAuthGuard)
@Controller("documents")
export class DocumentsController extends BaseDocumentsController {
  protected readonly kind = DocumentType.DOC;

  constructor(documents: DocumentsService, rtcTokens: RtcTokenService) {
    super(documents, rtcTokens);
  }
}

@UseGuards(JwtAuthGuard)
@Controller("sheets")
export class SheetsController extends BaseDocumentsController {
  protected readonly kind = DocumentType.SHEET;

  constructor(documents: DocumentsService, rtcTokens: RtcTokenService) {
    super(documents, rtcTokens);
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
