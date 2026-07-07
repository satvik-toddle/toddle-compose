import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from "./jwt.constants";
import type { AuthUser } from "./current-user.decorator";

// The single implementation of access-token verification. JwtAuthGuard (required auth)
// and optional-auth callers (public share-link routes) both resolve through here so
// token policy can never fork between the two paths.
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  // Resolve an Authorization header to the user it authenticates; null on any failure
  // (missing/malformed header, bad signature, wrong type, unknown user).
  async resolveAccessToken(header: string | undefined): Promise<AuthUser | null> {
    if (!header || !header.startsWith("Bearer ")) return null;
    const token = header.slice(7);
    let sub: string;
    let activeWorkspaceId: string | null = null;
    try {
      // Pin algorithm + iss/aud so foreign or downgraded JWTs are rejected.
      const payload = await this.jwt.verifyAsync(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.type !== "access") return null;
      sub = payload.sub;
      activeWorkspaceId = payload.activeWorkspaceId ?? null;
    } catch {
      return null;
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      activeWorkspaceId,
    };
  }
}
