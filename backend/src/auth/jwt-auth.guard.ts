import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";

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
    let sub: string;
    let activeWorkspaceId: string | null = null;
    try {
      const payload = await this.jwt.verifyAsync(token);
      // Reject refresh-type or otherwise non-access tokens used as a bearer.
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
    return true;
  }
}
