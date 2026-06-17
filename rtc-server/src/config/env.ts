import { z } from "zod";

export const envSchema = z.object({
  // Separate, write-heavy RTC database only.
  RTC_DATABASE_URL: z.string(),
  // Default is dev-only; production requires an explicit non-trivial token.
  INTERNAL_TOKEN:
    process.env.NODE_ENV === "production"
      ? z.string().min(32)
      : z.string().default("dev-internal-secret-change-me"),
  RTC_PORT: z.coerce.number().default(4001),
  RTC_WS_MAX_PAYLOAD_BYTES: z.coerce.number().default(4194304),
  RTC_INTERNAL_PORT: z.coerce.number().default(4002),
  JWKS_URL: z
    .string()
    .default("http://localhost:4000/.well-known/rtc-jwks.json"),
  RTC_TOKEN_ISS: z.string().default("toddlecompose-backend"),
  RTC_TOKEN_AUD: z.string().default("rtc-server"),
  RTC_DEBOUNCE_IDLE_MS: z.coerce.number().default(2000),
  RTC_DEBOUNCE_MAX_MS: z.coerce.number().default(10000),
  // Coalesce Yjs updates per (doc, author) into one log row; crash exposure is bounded by this window.
  RTC_APPEND_COALESCE_MS: z.coerce.number().default(250),
  // Headless-Lexical extraction worker threads (CPU-bound; keep small).
  RTC_EXTRACT_WORKERS: z.coerce.number().int().min(1).max(8).default(2),
  RTC_CHECKPOINT_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),
  RTC_COMPACT_INTERVAL_MS: z.coerce.number().default(60 * 60 * 1000),
  RTC_TIER1_AGE_MS: z.coerce.number().default(7 * 24 * 60 * 60 * 1000),
  RTC_TIER2_AGE_MS: z.coerce.number().default(30 * 24 * 60 * 60 * 1000),
  RTC_SESSION_GAP_MS: z.coerce.number().default(30 * 1000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}
