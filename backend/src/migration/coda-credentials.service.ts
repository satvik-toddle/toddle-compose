import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TokenCipher } from "./token-cipher";

// Loads and decrypts a destination's Coda token pool. This is the ONLY place
// tokens are turned back into plaintext; the plaintext is handed straight to
// CodaClient (which distributes writes across the pool, H1) and is never logged
// or returned to a client.
@Injectable()
export class CodaCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
  ) {}

  // Decrypt every token on a live (non-deleted) scope. Throws if the scope has none.
  async getTokenPool(scopeId: string): Promise<string[]> {
    const rows = await this.prisma.migrationScopeToken.findMany({
      where: { scopeId, scope: { deletedAt: null } },
      select: { codaTokenEnc: true },
    });
    if (rows.length === 0) {
      throw new NotFoundException("no Coda tokens configured for this destination");
    }
    return rows.map((r) => this.cipher.decrypt(r.codaTokenEnc));
  }
}
