import { z } from "zod";

/**
 * Backend env schema (modules wired so far: Config, Prisma, Keys, Auth, Users).
 * In production, secrets are REQUIRED with no insecure defaults — the app refuses
 * to boot without them; outside production some carry dev-only defaults (see
 * INTERNAL_TOKEN). Unknown vars in the root .env are ignored by zod.
 */
const isProduction = process.env.NODE_ENV === "production";

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),

  // The single realm this backend instance is pinned to. Every realm/workspace
  // operation scopes to it; the backend refuses to boot if no realm row matches
  // (run the seed to create it). See packages/database/prisma/seed.ts.
  REALM_ID: z.string().min(1, "REALM_ID is required"),

  // Signs access JWTs (HS256). Required; must be long/high-entropy. No default.
  JWT_USER_SECRET: z
    .string()
    .min(32, "JWT_USER_SECRET must be at least 32 characters"),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),

  // Short-lived access JWT; longer-lived rotating refresh token (persisted, revocable).
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(86400), // 24 h

  // CORS allowlist (comma-separated origins). No wildcard in production.
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  // RS256 keypair backing the JWKS endpoint (rtc-server verifies against it later).
  RTC_PRIVATE_KEY_PATH: z.string().default("./.keys/rtc-private.pem"),
  RTC_PUBLIC_KEY_PATH: z.string().default("./.keys/rtc-public.pem"),

  // RTC access tokens the backend mints (RS256, verified by the rtc-server via JWKS).
  // Short-lived by design: it only needs to cover the WS handshake (re-minted on
  // reconnect), so a leaked token ages out fast.
  RTC_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(300),
  RTC_TOKEN_ISS: z.string().default("toddlecompose-backend"),
  RTC_TOKEN_AUD: z.string().default("rtc-server"),

  // Internal HTTP channel to the rtc-server (shared-secret authed). The dev
  // default is convenience-only: production REQUIRES a long random secret.
  RTC_INTERNAL_URL: z.string().url().default("http://localhost:4002"),
  INTERNAL_TOKEN: isProduction
    ? z.string().min(32, "INTERNAL_TOKEN must be at least 32 characters in production")
    : z.string().min(1).default("dev-internal-secret-change-me"),

  // --- Object storage ---------------------------------------------------------
  // Public origin of THIS backend; used to build absolute URLs for stored objects
  // served by the local driver (e.g. <BACKEND_PUBLIC_URL>/api/uploads/<key>).
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  // Which ObjectStorage provider to use. `local` = filesystem (dev default);
  // `s3` = S3-compatible (AWS S3 / MinIO / Cloudflare R2). Swappable with no
  // consumer code changes — see backend/src/storage.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  // Local driver: directory uploaded files are written to (gitignored).
  STORAGE_DIR: z.string().default("./.storage"),
  // Max accepted upload size, in megabytes (both drivers).
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  // S3 driver settings — only consulted when STORAGE_DRIVER=s3. Left optional so
  // the app boots on the local driver without them; the S3 provider validates
  // what it needs at init and tells you exactly what's missing.
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(), // custom endpoint for MinIO / R2
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // If the bucket is fronted by a public/CDN base URL, objects link there;
  // otherwise the provider returns time-limited pre-signed GET URLs.
  STORAGE_S3_PUBLIC_URL: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false), // true for MinIO
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}

/** Parse a comma-separated CORS_ORIGINS value into a clean allowlist. */
export function corsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
