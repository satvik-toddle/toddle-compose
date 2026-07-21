import { randomBytes } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { parseEncKey, TokenCipher } from "./token-cipher";

function configWith(key: string | undefined): ConfigService<Env, true> {
  return {
    get: (name: string) => (name === "MIGRATION_ENC_KEY" ? key : undefined),
  } as unknown as ConfigService<Env, true>;
}

const base64Key = randomBytes(32).toString("base64");
const hexKey = randomBytes(32).toString("hex");

describe("parseEncKey", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(parseEncKey(base64Key)?.length).toBe(32);
  });

  it("accepts a 32-byte hex key", () => {
    expect(parseEncKey(hexKey)?.length).toBe(32);
  });

  it("rejects a missing or wrong-length key", () => {
    expect(parseEncKey(undefined)).toBeNull();
    expect(parseEncKey("")).toBeNull();
    expect(parseEncKey(randomBytes(16).toString("base64"))).toBeNull();
  });
});

describe("TokenCipher", () => {
  it("fail-fasts with a clear error when the key is missing/invalid", () => {
    expect(() => new TokenCipher(configWith(undefined))).toThrow(
      /MIGRATION_ENC_KEY/,
    );
    expect(() => new TokenCipher(configWith("too-short"))).toThrow(
      /MIGRATION_ENC_KEY/,
    );
  });

  it("round-trips plaintext through encrypt/decrypt", () => {
    const cipher = new TokenCipher(configWith(base64Key));
    const secret = "coda-token-db1ec733-51d4-44f8";
    const enc = cipher.encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(cipher.decrypt(enc)).toBe(secret);
  });

  it("produces a distinct ciphertext each time (random IV)", () => {
    const cipher = new TokenCipher(configWith(base64Key));
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("throws on a tampered ciphertext (GCM auth-tag mismatch)", () => {
    const cipher = new TokenCipher(configWith(base64Key));
    const enc = cipher.encrypt("secret-token");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => cipher.decrypt(buf.toString("base64"))).toThrow();
  });

  it("throws when decrypting with a different key", () => {
    const a = new TokenCipher(configWith(base64Key));
    const b = new TokenCipher(configWith(randomBytes(32).toString("base64")));
    expect(() => b.decrypt(a.encrypt("secret"))).toThrow();
  });
});
