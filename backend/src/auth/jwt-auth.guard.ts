import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  hashPersonalAccessToken,
  looksLikePersonalAccessToken,
} from "./personal-access-token.util";
import { setTokenAuth } from "./request-context";
import { AccessTokenService } from "./access-token.service";

const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }
    const token = header.slice(7);
    // ctk_ programmatic API token → our scoped path; otherwise it's a login JWT,
    // which we delegate to the shared resolver so token policy can't fork.
    if (looksLikePersonalAccessToken(token)) {
      return this.authenticatePersonalAccessToken(req, token);
    }
    const user = await this.accessTokens.resolveAccessToken(header);
    if (!user) throw new UnauthorizedException("invalid token");
    req.user = user;
    setTokenAuth(null);
    return true;
  }

  private async authenticatePersonalAccessToken(req: any, raw: string): Promise<boolean> {
    const record = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash: hashPersonalAccessToken(raw) },
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
    await this.prisma.personalAccessToken
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}
