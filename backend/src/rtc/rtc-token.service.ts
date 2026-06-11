import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT } from "jose";
import { randomUUID } from "crypto";
import { KeysService } from "../keys/keys.service";
import type { AuthUser } from "../auth/current-user.decorator";
import type { Env } from "../config/env";

// The rtc-server treats 'denied' as a hard reject; the backend never mints it
// (it returns 403 instead), so only the two grant roles are emitted here.
export type RtcRole = "editor" | "viewer";

/**
 * Mints the short-lived RS256 token a client presents to the rtc-server. The
 * rtc-server verifies it via the backend's JWKS and trusts the claims — so the
 * permission decision is made HERE (per-request, against the live DB) and frozen
 * into the token. Identity claims (name/email/color) drive presence/cursors.
 */
@Injectable()
export class RtcTokenService {
  constructor(
    private readonly keys: KeysService,
    private readonly config: ConfigService<Env, true>
  ) {}

  async mint(user: AuthUser, docId: string, role: RtcRole): Promise<string> {
    const { privateKey } = await this.keys.getKeys();
    // ±10% jitter: the rtc-server closes sockets at token expiry, so tokens
    // minted together (page load after a deploy) must not all expire — and
    // trigger reconnect+cold-load — in the same instant.
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
