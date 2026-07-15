import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import type { Env } from "../config/env";

// Shared-secret guard for service-to-service calls (rtc-server → backend), mirroring the
// rtc-server's guard: constant-time compare of the X-Internal-Token header vs INTERNAL_TOKEN.
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers["x-internal-token"];
    const expected = this.config.get("INTERNAL_TOKEN", { infer: true });
    if (typeof provided !== "string") {
      throw new UnauthorizedException("invalid internal token");
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("invalid internal token");
    }
    return true;
  }
}
