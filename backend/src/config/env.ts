import { z } from "zod";

/**
 * Backend env schema (modules wired so far: Config, Prisma, Keys, Auth, Users).
 * Secrets are REQUIRED with no insecure defaults — the app refuses to boot without
 * them. Unknown vars in the root .env are ignored by zod.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),

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
