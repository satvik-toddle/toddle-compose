import { z } from "zod";

export const envSchema = z.object({
  // Separate, write-heavy RTC database only.
  RTC_DATABASE_URL: z.string(),
  // Default is dev-only; production requires an explicit non-trivial token.
  INTERNAL_TOKEN:
    process.env.NODE_ENV === "production"
      ? z.string().min(32)
      : z.string().default("dev-internal-secret-change-me"),
  // Backend (app) database — used ONLY by the indexer worker, which writes the search
  // projection directly. Optional so the WS server (which never touches it) can boot without it;
  // the worker fails fast at startup if it's missing.
  DATABASE_URL: z.string().optional(),
  // Indexer worker: HTTP port for the /wake ping, the coalescing/cron window, a slow safety
  // sweep that catches lost pings, and the URL rtc pings after enqueuing.
  INDEXER_PORT: z.coerce.number().default(4100),
  INDEXER_INTERVAL_MS: z.coerce.number().default(5000),
  INDEXER_SAFETY_SWEEP_MS: z.coerce.number().default(60000),
  INDEXER_WAKE_URL: z.string().url().default("http://localhost:4100/wake"),
  // On worker boot, enqueue docs that have an rtc snapshot but no backend index row yet
  // (never-indexed or fell behind) so the queue self-heals without a manual backfill. Idempotent
  // (~zero work once caught up). Set false to skip the boot scan on large corpora / fast restarts.
  INDEXER_BACKFILL_ON_BOOT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  RTC_PORT: z.coerce.number().default(4001),
  RTC_WS_MAX_PAYLOAD_BYTES: z.coerce.number().default(4194304),
  // Per-connection token bucket for inbound WS messages: bucket size (burst) and steady refill rate per second.
  RTC_RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(500),
  RTC_RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().int().positive().default(100),
  JWKS_URL: z
    .string()
    .default("http://localhost:4000/.well-known/rtc-jwks.json"),
  RTC_TOKEN_ISS: z.string().default("toddlecompose-backend"),
  RTC_TOKEN_AUD: z.string().default("rtc-server"),
  RTC_DEBOUNCE_IDLE_MS: z.coerce.number().default(2000),
  RTC_DEBOUNCE_MAX_MS: z.coerce.number().default(10000),
  // Coalesce Yjs updates per (doc, author) into one log row; crash exposure is bounded by this window.
  RTC_APPEND_COALESCE_MS: z.coerce.number().default(1000),
  // Headless-Lexical extraction worker threads (CPU-bound; keep small).
  RTC_EXTRACT_WORKERS: z.coerce.number().int().min(1).max(8).default(2),
  RTC_CHECKPOINT_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),
  RTC_COMPACT_INTERVAL_MS: z.coerce.number().default(6 * 60 * 60 * 1000),
  // Raw keystroke-window rows dominate the table; 12h bounds them to ~half a day's worth per doc.
  RTC_TIER1_AGE_MS: z.coerce.number().default(12 * 60 * 60 * 1000),
  RTC_TIER2_AGE_MS: z.coerce.number().default(30 * 24 * 60 * 60 * 1000),
  RTC_SESSION_GAP_MS: z.coerce.number().default(30 * 1000),

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
