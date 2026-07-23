import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CodaClient } from "../coda/coda.client";
import { sanitizeCodaImportHtml } from "../coda/coda-import-sanitizer";
import { DocumentsService } from "../documents/documents.service";
import { RtcContentClient } from "../rtc/rtc-content.client";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { AuthUser } from "../auth/current-user.decorator";
import { CodaCredentialsService } from "./coda-credentials.service";
import { ScopeValidationService } from "./scope-validation.service";

// "Import from Coda" (Phase 5): synchronously overwrite one doc's body with a Coda page's content.
// Destructive by design — the whole body is replaced atomically. Reuses the Copy-to-Coda scope
// primitives (scope validation, token pool, export) in reverse.
@Injectable()
export class ImportFromCodaService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: DocumentsModule ↔ MigrationModule already form a module cycle.
    @Inject(forwardRef(() => DocumentsService))
    private readonly documents: DocumentsService,
    private readonly scopeValidation: ScopeValidationService,
    private readonly credentials: CodaCredentialsService,
    private readonly coda: CodaClient,
    private readonly rtcContent: RtcContentClient,
    private readonly rtcInternal: RtcInternalClient,
  ) {}

  async import(
    user: AuthUser,
    docId: string,
    scopeId: string,
    url: string,
  ): Promise<{ ok: true; losses: string[] }> {
    // Editor gate: resolveRtcRole is the same grant-aware check that mints the doc's editor
    // rtc-token (owner/EDIT+ → "editor"); anything less can't overwrite the body.
    const role = await this.documents.resolveRtcRole(user.id, docId);
    if (role !== "editor") {
      throw new ForbiddenException("requires editor access to this document");
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: { workspaceId: true },
    });
    if (!doc) throw new NotFoundException("document not found");

    const scope = await this.prisma.migrationScope.findFirst({
      where: { id: scopeId, deletedAt: null },
      select: { workspaceId: true, codaDocId: true },
    });
    if (!scope) throw new NotFoundException("destination not found");
    // A scope may only import into docs of its own workspace.
    if (scope.workspaceId !== doc.workspaceId) {
      throw new NotFoundException("destination not found");
    }

    // Validates + scope-checks the URL, returning the target page.
    const { codaPageId } = await this.scopeValidation.validateDestinationUrl(
      scopeId,
      url,
    );

    const pool = await this.credentials.getTokenPool(scopeId);
    const rawHtml = await this.coda.exportPage(pool, scope.codaDocId, codaPageId);
    const { html, losses } = sanitizeCodaImportHtml(rawHtml);

    // Ensure a never-opened doc has an rtc row before the write; lazy-created otherwise.
    await this.rtcInternal.initDocBestEffort(docId);
    await this.rtcContent.replaceHtml(docId, html, user);

    return { ok: true, losses };
  }
}
