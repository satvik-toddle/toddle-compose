import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers["x-internal-token"];
    if (provided !== this.config.get("INTERNAL_TOKEN", { infer: true })) {
      throw new UnauthorizedException("invalid internal token");
    }
    return true;
  }
}
