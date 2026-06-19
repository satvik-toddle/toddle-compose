import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from "./jwt.constants";
import { hashAccessToken, looksLikeAccessToken } from "./access-token.util";
import { setTokenAuth } from "./request-context";

const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }
    const token = header.slice(7);
    return looksLikeAccessToken(token)
      ? this.authenticateAccessToken(req, token)
      : this.authenticateJwt(req, token);
  }

  private async authenticateJwt(req: any, token: string): Promise<boolean> {
    let sub: string;
    let activeWorkspaceId: string | null = null;
    try {
      // Pin algorithm + iss/aud so foreign or downgraded JWTs are rejected.
      const payload = await this.jwt.verifyAsync(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.type !== "access") {
        throw new UnauthorizedException("not an access token");
      }
      sub = payload.sub;
      activeWorkspaceId = payload.activeWorkspaceId ?? null;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) throw new UnauthorizedException("user not found");
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      activeWorkspaceId,
    };
    setTokenAuth(null);
    return true;
  }

  private async authenticateAccessToken(req: any, raw: string): Promise<boolean> {
    const record = await this.prisma.accessToken.findUnique({
      where: { tokenHash: hashAccessToken(raw) },
      include: { createdBy: true },
    });
    if (!record || record.revokedAt) {
      throw new UnauthorizedException("invalid access token");
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("access token expired");
    }
    const user = record.createdBy;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      activeWorkspaceId: record.workspaceId,
    };
    setTokenAuth({
      scope: record.scope,
      workspaceId: record.workspaceId,
      permission: record.permission,
    });
    await this.touchLastUsed(record.id, record.lastUsedAt);
    return true;
  }

  private async touchLastUsed(id: string, lastUsedAt: Date | null): Promise<void> {
    if (lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) {
      return;
    }
    await this.prisma.accessToken
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}
