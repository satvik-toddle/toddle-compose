import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from "../auth/jwt.constants";

// EventSource can't set headers, so the access token arrives as a `?token=` query param.
// Verification mirrors JwtAuthGuard; the workspace READ gate ensures a member only streams
// workspaces they can already see.
@Injectable()
export class WorkspaceStreamGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.query?.token;
    if (!token) throw new UnauthorizedException("missing token");

    let sub: string;
    let exp: number | undefined;
    try {
      const payload = await this.jwt.verifyAsync(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.type !== "access") {
        throw new UnauthorizedException("not an access token");
      }
      sub = payload.sub;
      exp = typeof payload.exp === "number" ? payload.exp : undefined;
    } catch {
      throw new UnauthorizedException("invalid token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, name: true, color: true },
    });
    if (!user) throw new UnauthorizedException("user not found");

    const workspaceId: string = req.params.workspaceId;
    const role = await this.authz.effectiveWorkspaceRole(user.id, workspaceId);
    // Grant-only guests may stream, but only for docs they were granted — collect that allowlist
    // here (also serves as the access check: no grants → no access). Members get null (see all).
    let guestDocIds: string[] | null = null;
    if (role === null) {
      const granted = await this.prisma.documentPermission.findMany({
        where: { userId: user.id, document: { workspaceId } },
        select: { documentId: true },
      });
      if (granted.length === 0) {
        throw new UnauthorizedException("no access to this workspace");
      }
      guestDocIds = granted.map((g) => g.documentId);
    }

    req.user = { ...user, activeWorkspaceId: null };
    // Surfaced so the stream self-closes at expiry instead of outliving the token.
    req.tokenExp = exp;
    // null → full member (all events); a list → grant-only guest, filter metadata to these docs.
    req.guestDocIds = guestDocIds;
    return true;
  }
}
