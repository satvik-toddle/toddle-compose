import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT } from "jose";
import { randomUUID } from "crypto";
import { KeysService } from "../keys/keys.service";
import type { AuthUser } from "../auth/current-user.decorator";
import type { Env } from "../config/env";

export type RtcRole = "editor" | "viewer";

// Mints the short-lived RS256 token; the permission decision is made here and frozen into it.
@Injectable()
export class RtcTokenService {
  constructor(
    private readonly keys: KeysService,
    private readonly config: ConfigService<Env, true>
  ) {}

  async mint(user: AuthUser, docId: string, role: RtcRole): Promise<string> {
    const { privateKey } = await this.keys.getKeys();
    // ±10% jitter so tokens minted together don't all expire (and reconnect) at once.
    const baseTtl = this.config.get("RTC_TOKEN_TTL_SEC", { infer: true });
    const ttl = Math.round(baseTtl * (0.9 + Math.random() * 0.2));
    return new SignJWT({
      docId,
      role,
      name: user.name,
      email: user.email,
      color: user.color,
    })
      .setProtectedHeader({ alg: this.keys.alg, typ: "JWT", kid: this.keys.kid })
      .setSubject(user.id)
      .setAudience(this.config.get("RTC_TOKEN_AUD", { infer: true }))
      .setIssuer(this.config.get("RTC_TOKEN_ISS", { infer: true }))
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .setJti(randomUUID())
      .sign(privateKey);
  }
}
