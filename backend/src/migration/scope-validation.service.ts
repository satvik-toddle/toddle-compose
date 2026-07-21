import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CodaClient } from "../coda/coda.client";
import { CodaCredentialsService } from "./coda-credentials.service";
import { resolveTarget } from "./coda-resolve";

// Cap the parent-walk so a malformed/cyclic Coda ancestry can never loop forever (H6).
const MAX_ANCESTOR_DEPTH = 50;

// Validates a per-row destination URL against a scope. Consumed by the Phase 4b
// enqueue path (no endpoint yet). A whole-doc scope (codaRootPageId null) accepts
// any page in the same doc; a page-root scope requires the page be a descendant
// of the root and forbids targeting the root itself (§5).
@Injectable()
export class ScopeValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coda: CodaClient,
    private readonly credentials: CodaCredentialsService,
  ) {}

  async validateDestinationUrl(
    scopeId: string,
    url: string,
  ): Promise<{ codaPageId: string }> {
    const scope = await this.prisma.migrationScope.findFirst({
      where: { id: scopeId, deletedAt: null },
      select: { id: true, codaDocId: true, codaRootPageId: true },
    });
    if (!scope) throw new NotFoundException("destination not found");

    const pool = await this.credentials.getTokenPool(scopeId);
    const target = await resolveTarget(this.coda, pool, url);

    // Must be a page (H5) inside the scope's doc.
    if (target.kind !== "page" || target.pageId === null) {
      throw new BadRequestException("destination URL must point to a Coda page");
    }
    if (target.docId !== scope.codaDocId) {
      throw new BadRequestException(
        "destination URL is in a different Coda doc than this scope",
      );
    }

    // Whole-doc scope: no root page to protect, any in-doc page is valid.
    if (scope.codaRootPageId === null) {
      return { codaPageId: target.pageId };
    }

    // Page-root scope: the root itself is not overridable (§5).
    if (target.pageId === scope.codaRootPageId) {
      throw new BadRequestException(
        "the scope root page cannot be used as a destination",
      );
    }

    await this.assertDescendantOfRoot(
      pool,
      scope.codaDocId,
      target.pageId,
      scope.codaRootPageId,
    );
    return { codaPageId: target.pageId };
  }

  // Walk immediate parents up from `pageId` looking for `rootPageId` (H6: getPage
  // exposes only the immediate parent, so ancestry is N sequential reads). A null
  // parent (top of doc) or the depth cap means "not a descendant" → reject.
  private async assertDescendantOfRoot(
    pool: string[],
    docId: string,
    pageId: string,
    rootPageId: string,
  ): Promise<void> {
    let currentId = pageId;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
      const page = await this.coda.getPage(pool, docId, currentId);
      const parentId = page.parent?.id ?? null;
      if (parentId === null) break;
      if (parentId === rootPageId) return;
      currentId = parentId;
    }
    throw new BadRequestException(
      "destination page is not within the scope root",
    );
  }
}
