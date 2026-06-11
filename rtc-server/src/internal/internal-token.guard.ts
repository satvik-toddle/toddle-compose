import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import type { Env } from "../config/env";

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
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    // timingSafeEqual requires equal byte lengths; a length mismatch is an
    // immediate (non-secret-dependent) reject.
    if (
      providedBuf.byteLength !== expectedBuf.byteLength ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException("invalid internal token");
    }
    return true;
  }
}
