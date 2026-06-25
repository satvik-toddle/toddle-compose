import { z } from "zod";
import { RATE_LIMIT_DEFAULTS } from "./rate-limit";

// In production, secrets are REQUIRED with no defaults; outside production some carry dev-only defaults (see INTERNAL_TOKEN).
const isProduction = process.env.NODE_ENV === "production";

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),

  // The single realm this backend is pinned to; refuses to boot if no realm row matches (run the seed).
  REALM_ID: z.string().min(1, "REALM_ID is required"),

  // Signs access JWTs (HS256); must be long/high-entropy, no default.
  JWT_USER_SECRET: z
    .string()
    .min(32, "JWT_USER_SECRET must be at least 32 characters"),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),

  // Short-lived access JWT; longer-lived rotating refresh token (persisted, revocable).
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(86400), // 24 h

  // CORS allowlist (comma-separated origins). No wildcard in production.
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  // --- Email verification -----------------------------------------------------
  // Public origin of the frontend; used to build the verification link emailed
  // on sign-up (`${FRONTEND_URL}/verify-email?token=...`).
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  // How long a sign-up verification token stays valid. Short-lived by design.
  EMAIL_VERIFICATION_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
  // How long a "forgot password" reset token stays valid. Short-lived by design.
  PASSWORD_RESET_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
  // Minimum gap between verification/reset emails to the SAME account, in
  // seconds. Enforced server-side (per email, not per IP) so a fresh token +
  // email is issued at most once per window. 0 disables the cooldown.
  EMAIL_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(60),
  // Gmail SMTP credentials (account address + app password). When BOTH are set
  // mail is sent via Gmail; otherwise the mailer logs the message (incl. the
  // verify link) to the console for local development. REQUIRED in production so
  // a misconfigured deploy fails closed instead of logging live links in plaintext.
  GMAIL_SERVICE_EMAIL: isProduction
    ? z.string().email()
    : z.string().email().optional(),
  GMAIL_SERVICE_PASSWORD: isProduction
    ? z.string().min(1, "GMAIL_SERVICE_PASSWORD is required in production")
    : z.string().optional(),
  // Display name on the From header.
  MAIL_FROM_NAME: z.string().default("Toddle Compose"),

  // --- Rate limiting (@nestjs/throttler) -------------------------------------
  // Window all limits below are measured over, in milliseconds.
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.ttlMs),
  // Global default (per client IP) for routes guarded by ThrottlerGuard.
  RATE_LIMIT_GLOBAL_LIMIT: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.globalLimit),
  // Stricter per-route caps on the unauthenticated auth endpoints (anti credential-stuffing).
  RATE_LIMIT_AUTH_REGISTER: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.authRegister),
  RATE_LIMIT_AUTH_LOGIN: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.authLogin),
  RATE_LIMIT_AUTH_REFRESH: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.authRefresh),

  // --- Document metadata cache -----------------------------------------------
  // How long a cached document row stays fresh before the next read reloads it from the DB.
  // In-memory + per-instance (like the throttler above), so N replicas each keep their own copy.
  DOCUMENT_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000), // 5 min

  // RS256 keypair backing the JWKS endpoint (rtc-server verifies against it later).
  RTC_PRIVATE_KEY_PATH: z.string().default("./.keys/rtc-private.pem"),
  RTC_PUBLIC_KEY_PATH: z.string().default("./.keys/rtc-public.pem"),

  // RTC access tokens (RS256, verified by rtc-server via JWKS); short-lived since they only cover the WS handshake.
  RTC_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(300),
  RTC_TOKEN_ISS: z.string().default("toddlecompose-backend"),
  RTC_TOKEN_AUD: z.string().default("rtc-server"),

  // Internal HTTP channel to rtc-server (shared-secret authed); production REQUIRES a long random secret.
  RTC_INTERNAL_URL: z.string().url().default("http://localhost:4002"),
  INTERNAL_TOKEN: isProduction
    ? z.string().min(32, "INTERNAL_TOKEN must be at least 32 characters in production")
    : z.string().min(1).default("dev-internal-secret-change-me"),

  // --- Object storage ---------------------------------------------------------
  // Public origin of THIS backend; used to build absolute URLs for objects served by the local driver.
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  // ObjectStorage provider: local filesystem or s3-compatible (swappable with no consumer changes).
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  // Local driver: directory uploaded files are written to (gitignored).
  STORAGE_DIR: z.string().default("./.storage"),
  // Max accepted upload size, in megabytes (both drivers).
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  // S3 driver settings (only consulted when STORAGE_DRIVER=s3); optional so the app boots on the local driver.
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(), // custom endpoint for MinIO / R2
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // If set, objects link to this public/CDN base URL; otherwise the provider returns pre-signed GET URLs.
  STORAGE_S3_PUBLIC_URL: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false), // true for MinIO

  // --- Request tracing --------------------------------------------------------
  // Logs per-request timing + per-query DB durations to the console. Off by
  // default; set TRACE_REQUESTS=true for local debugging. Strict enum (not
  // z.coerce.boolean, which treats "false" as true) so the value is explicit.
  TRACE_REQUESTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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
