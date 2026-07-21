import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Env } from "../config/env";

// AES-256-GCM. Key from MIGRATION_ENC_KEY (base64 or hex, 32 bytes). Compact
// wire format is base64(iv[12] || authTag[16] || ciphertext). The GCM auth tag
// makes any tamper (flipped byte, wrong key) fail closed on decrypt.
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Decode a base64 or hex key string to raw bytes; returns null if neither yields 32 bytes.
export function parseEncKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hex = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : null;
  if (hex && hex.length === KEY_BYTES) return hex;
  try {
    const b64 = Buffer.from(trimmed, "base64");
    if (b64.length === KEY_BYTES) return b64;
  } catch {
    // fall through
  }
  return null;
}

@Injectable()
export class TokenCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const key = parseEncKey(config.get("MIGRATION_ENC_KEY", { infer: true }));
    if (!key) {
      throw new Error(
        "MIGRATION_ENC_KEY must be a 32-byte key (base64 or hex) to encrypt Coda migration tokens",
      );
    }
    this.key = key;
  }

  // plaintext -> base64(iv || tag || ciphertext)
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
  }

  // Reverses encrypt; throws if the payload is malformed or has been tampered with.
  decrypt(enc: string): string {
    const buf = Buffer.from(enc, "base64");
    if (buf.length < IV_BYTES + TAG_BYTES) {
      throw new Error("invalid encrypted token payload");
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    // final() throws on an auth-tag mismatch (tampered ciphertext / wrong key).
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
