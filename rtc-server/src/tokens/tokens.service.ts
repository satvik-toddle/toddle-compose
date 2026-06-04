import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../config/env";
import { createLogger } from "../logger";

const log = createLogger("token");

export type Role = "editor" | "viewer" | "denied";
export type RtcClaims = { sub: string; docId: string; role: Role };

@Injectable()
export class TokensService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly iss: string;
  private readonly aud: string;

  constructor(config: ConfigService<Env, true>) {
    this.jwks = createRemoteJWKSet(
      new URL(config.get("JWKS_URL", { infer: true }))
    );
    this.iss = config.get("RTC_TOKEN_ISS", { infer: true });
    this.aud = config.get("RTC_TOKEN_AUD", { infer: true });
  }

  async verify(token: string): Promise<RtcClaims> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.iss,
      audience: this.aud,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.docId !== "string" ||
      (payload.role !== "editor" &&
        payload.role !== "viewer" &&
        payload.role !== "denied")
    ) {
      log.warn(
        `invalid claims sub=${payload.sub} docId=${payload.docId} role=${payload.role}`
      );
      throw new Error("invalid claims");
    }
    if (payload.role === "denied") {
      throw new Error("access denied");
    }
    return {
      sub: payload.sub,
      docId: payload.docId as string,
      role: payload.role,
    };
  }
}
