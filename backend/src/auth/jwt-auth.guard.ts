import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AccessTokenService } from "./access-token.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = await this.accessTokens.resolveAccessToken(
      req.headers["authorization"]
    );
    if (!user) throw new UnauthorizedException("invalid or missing access token");
    req.user = user;
    return true;
  }
}
