import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { TokenCipher } from "../migration/token-cipher";
import { CreateCodaImportCredentialDto } from "./dto";

// Masked, plaintext-free view of a credential row for API responses.
interface CredentialView {
  id: string;
  label: string | null;
  hint: string | null;
  createdAt: Date;
}

// The GLOBAL Coda read-token pool for "Import from Coda". Unlike per-scope tokens
// (MigrationScopeToken), imports target a workspace that doesn't exist yet, so
// these tokens are unscoped and realm-admin managed. This is the ONLY place a
// stored token is decrypted; plaintext goes straight to CodaClient and is never
// logged or returned to a client. All mutations are realm-admin gated (MAINTAINER+).
@Injectable()
export class CodaImportCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly cipher: TokenCipher,
  ) {}

  // Masked listing — carries only id/label/hint, never codaTokenEnc/plaintext.
  async list(userId: string): Promise<CredentialView[]> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const rows = await this.prisma.codaImportCredential.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toView);
  }

  // Encrypt the token, derive its masked last-4 hint, persist. Realm-admin only.
  async create(
    userId: string,
    dto: CreateCodaImportCredentialDto,
  ): Promise<CredentialView> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const created = await this.prisma.codaImportCredential.create({
      data: {
        codaTokenEnc: this.cipher.encrypt(dto.token),
        codaTokenHint: dto.token.slice(-4),
        label: dto.label ?? null,
        createdById: userId,
      },
    });
    return toView(created);
  }

  // Realm-admin only. Idempotent: deleting an already-gone id is not an error.
  async remove(userId: string, id: string): Promise<{ id: string }> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    await this.prisma.codaImportCredential.deleteMany({ where: { id } });
    return { id };
  }

  // Decrypt every stored credential for the import worker. The DB is the single
  // source of truth — tokens are seeded via the admin credential endpoint, never
  // read from the environment. Not auth-gated — internal, called by worker/planner.
  async getTokenPool(): Promise<string[]> {
    const rows = await this.prisma.codaImportCredential.findMany({
      select: { codaTokenEnc: true },
    });
    return rows.map((r) => this.cipher.decrypt(r.codaTokenEnc));
  }

  // Decrypt ONE stored credential — the token an import job was pinned to. Throws if
  // the credential is missing/deleted so a job never silently runs on the wrong token.
  // Not auth-gated — internal, called by validate/enqueue/worker.
  async getToken(credentialId: string): Promise<string> {
    const row = await this.prisma.codaImportCredential.findUnique({
      where: { id: credentialId },
      select: { codaTokenEnc: true },
    });
    if (!row) throw new NotFoundException("Coda import credential not found");
    return this.cipher.decrypt(row.codaTokenEnc);
  }
}

// Never surfaces codaTokenEnc — API responses carry only id/label/hint.
function toView(
  row: Prisma.CodaImportCredentialGetPayload<object>,
): CredentialView {
  return {
    id: row.id,
    label: row.label,
    hint: row.codaTokenHint,
    createdAt: row.createdAt,
  };
}
