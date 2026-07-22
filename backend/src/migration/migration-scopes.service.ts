import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MigrationScope, MigrationScopeToken, Prisma } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { ActiveRealmService } from "../realm/active-realm.service";
import { CodaClient } from "../coda/coda.client";
import { TokenCipher } from "./token-cipher";
import { resolveTarget, ResolvedTarget } from "./coda-resolve";
import {
  CreateMigrationScopeDto,
  ScopeTokenInputDto,
  UpdateMigrationScopeDto,
} from "./dto";
import { NON_TERMINAL_JOB_STATUSES } from "./job-status";

// Masked, plaintext-free view of a token row for API responses.
interface ScopeTokenView {
  id: string;
  label: string | null;
  hint: string | null;
  createdAt: Date;
}

interface ScopeView {
  id: string;
  workspaceId: string;
  label: string;
  codaDocId: string;
  codaRootPageId: string | null;
  codaRootUrl: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  tokens: ScopeTokenView[];
}

type ScopeWithTokens = MigrationScope & { tokens: MigrationScopeToken[] };

@Injectable()
export class MigrationScopesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly realm: ActiveRealmService,
    private readonly coda: CodaClient,
    private readonly cipher: TokenCipher,
  ) {}

  // GET: workspaceId set → that workspace's scopes (requires workspace EDIT, so the
  // Copy-to-Coda modal offered to EDIT+ users can list destinations); absent →
  // org-wide admin-console listing (requires realm admin). Both return masked token
  // hints only — never plaintext (create/update/delete stay ADMIN-gated).
  async list(userId: string, workspaceId?: string): Promise<ScopeView[]> {
    if (workspaceId) {
      await this.authz.requireWorkspaceRole(userId, workspaceId, "EDIT");
      const scopes = await this.prisma.migrationScope.findMany({
        where: { workspaceId, deletedAt: null },
        include: { tokens: true },
        orderBy: { createdAt: "asc" },
      });
      return scopes.map(toScopeView);
    }

    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const scopes = await this.prisma.migrationScope.findMany({
      where: { deletedAt: null, workspace: { realmId: this.realm.id } },
      include: { tokens: true },
      orderBy: { createdAt: "asc" },
    });
    return scopes.map(toScopeView);
  }

  // POST: validate every token against the target URL, then persist the scope +
  // its token pool in one transaction. Requires workspace ADMIN.
  async create(userId: string, dto: CreateMigrationScopeDto): Promise<ScopeView> {
    await this.authz.requireWorkspaceRole(userId, dto.workspaceId, "ADMIN");

    const resolved = await this.validateTokensAgainstUrl(
      dto.tokens,
      dto.codaUrl,
    );

    const created = await this.prisma.migrationScope.create({
      data: {
        workspaceId: dto.workspaceId,
        codaDocId: resolved.docId,
        codaRootPageId: resolved.pageId,
        codaRootUrl: resolved.canonicalUrl,
        label: dto.label,
        createdById: userId,
        tokens: {
          create: dto.tokens.map((t) => this.tokenCreateData(t)),
        },
      },
      include: { tokens: true },
    });
    return toScopeView(created);
  }

  // PATCH: rename and/or add/remove tokens. Added tokens are re-validated against
  // the scope's already-resolved doc/page. Requires the scope's workspace ADMIN.
  async update(
    userId: string,
    scopeId: string,
    dto: UpdateMigrationScopeDto,
  ): Promise<ScopeView> {
    const scope = await this.loadScopeForWrite(userId, scopeId);

    const addData: Prisma.MigrationScopeTokenCreateWithoutScopeInput[] = [];
    if (dto.addTokens && dto.addTokens.length > 0) {
      await this.validateTokensAgainstUrl(dto.addTokens, scope.codaRootUrl, {
        expectDocId: scope.codaDocId,
        expectPageId: scope.codaRootPageId,
      });
      for (const t of dto.addTokens) addData.push(this.tokenCreateData(t));
    }

    const removeIds = dto.removeTokenIds ?? [];
    const removedCount = scope.tokens.filter((t) =>
      removeIds.includes(t.id),
    ).length;

    // Reject before mutating if the edit would leave the pool empty.
    if (scope.tokens.length - removedCount + addData.length < 1) {
      throw new BadRequestException("a destination must keep at least one token");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (removeIds.length > 0) {
        await tx.migrationScopeToken.deleteMany({
          where: { scopeId, id: { in: removeIds } },
        });
      }
      return tx.migrationScope.update({
        where: { id: scopeId },
        data: {
          label: dto.label,
          ...(addData.length > 0 ? { tokens: { create: addData } } : {}),
        },
        include: { tokens: true },
      });
    });
    return toScopeView(updated);
  }

  // DELETE: soft-delete the scope AND cancel its non-terminal jobs in one
  // transaction, so no in-flight job dangles against a removed destination (D8/P7).
  async remove(userId: string, scopeId: string): Promise<{ id: string }> {
    await this.loadScopeForWrite(userId, scopeId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.migrationScope.update({
        where: { id: scopeId },
        data: { deletedAt: now },
      }),
      this.prisma.migrationJob.updateMany({
        where: { scopeId, status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
        data: { status: "CANCELED", finishedAt: now },
      }),
    ]);
    return { id: scopeId };
  }

  // --- internals ------------------------------------------------------------

  // Load a live scope and assert the caller is ADMIN on its workspace.
  private async loadScopeForWrite(
    userId: string,
    scopeId: string,
  ): Promise<ScopeWithTokens> {
    const scope = await this.prisma.migrationScope.findFirst({
      where: { id: scopeId, deletedAt: null },
      include: { tokens: true },
    });
    if (!scope) throw new NotFoundException("destination not found");
    await this.authz.requireWorkspaceRole(userId, scope.workspaceId, "ADMIN");
    return scope;
  }

  // Resolve the URL with EACH token and confirm access; assert all tokens agree
  // on the resolved doc/page. Returns the agreed target. Rejects (400) otherwise.
  private async validateTokensAgainstUrl(
    tokens: ScopeTokenInputDto[],
    url: string,
    expected?: { expectDocId: string; expectPageId: string | null },
  ): Promise<ResolvedTarget> {
    let agreed: ResolvedTarget | null = null;

    for (const { token } of tokens) {
      const target = await resolveTarget(this.coda, token, url);

      // Confirm this token can actually access the resolved resource.
      try {
        if (target.kind === "doc") {
          await this.coda.getDoc(token, target.docId);
        } else {
          await this.coda.getPage(token, target.docId, target.pageId!);
        }
      } catch {
        throw new BadRequestException(
          "a provided Coda token cannot access the destination",
        );
      }

      if (agreed === null) {
        agreed = target;
      } else if (
        target.docId !== agreed.docId ||
        target.pageId !== agreed.pageId
      ) {
        throw new BadRequestException(
          "the provided tokens resolve the URL to different Coda destinations",
        );
      }
    }

    if (!agreed) throw new BadRequestException("at least one token is required");

    // On PATCH, added tokens must resolve to the SAME doc/page as the scope.
    if (
      expected &&
      (agreed.docId !== expected.expectDocId ||
        agreed.pageId !== expected.expectPageId)
    ) {
      throw new BadRequestException(
        "added token resolves to a different Coda destination than this scope",
      );
    }
    return agreed;
  }

  // Encrypt the token and derive its masked last-4 hint for the DB row.
  private tokenCreateData(
    t: ScopeTokenInputDto,
  ): Prisma.MigrationScopeTokenCreateWithoutScopeInput {
    return {
      codaTokenEnc: this.cipher.encrypt(t.token),
      codaTokenHint: t.token.slice(-4),
      label: t.label ?? null,
    };
  }
}

// Never surfaces codaTokenEnc — API responses carry only id/label/hint.
function toScopeView(scope: ScopeWithTokens): ScopeView {
  return {
    id: scope.id,
    workspaceId: scope.workspaceId,
    label: scope.label,
    codaDocId: scope.codaDocId,
    codaRootPageId: scope.codaRootPageId,
    codaRootUrl: scope.codaRootUrl,
    createdById: scope.createdById,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
    tokens: scope.tokens.map((t) => ({
      id: t.id,
      label: t.label,
      hint: t.codaTokenHint,
      createdAt: t.createdAt,
    })),
  };
}
