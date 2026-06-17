import type { ExecutionContext } from "@nestjs/common";

// All rate-limit knobs are env-overridable. They're exposed as resolver
// functions (not plain numbers) because @nestjs/throttler evaluates the
// `@Throttle()` decorators at import time — before ConfigModule has populated
// process.env from ../.env — so the values must be read per request instead of
// at module load. The defaults below mirror the zod defaults in `env.ts`.
export const RATE_LIMIT_DEFAULTS = {
  ttlMs: 60_000,
  globalLimit: 100,
  authRegister: 5,
  authLogin: 10,
  authRefresh: 60,
} as const;

function envInt(
  key: string,
  fallback: number,
): (context?: ExecutionContext) => number {
  return () => {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
}

export const rateLimit = {
  ttlMs: envInt("RATE_LIMIT_TTL_MS", RATE_LIMIT_DEFAULTS.ttlMs),
  globalLimit: envInt("RATE_LIMIT_GLOBAL_LIMIT", RATE_LIMIT_DEFAULTS.globalLimit),
  authRegister: envInt("RATE_LIMIT_AUTH_REGISTER", RATE_LIMIT_DEFAULTS.authRegister),
  authLogin: envInt("RATE_LIMIT_AUTH_LOGIN", RATE_LIMIT_DEFAULTS.authLogin),
  authRefresh: envInt("RATE_LIMIT_AUTH_REFRESH", RATE_LIMIT_DEFAULTS.authRefresh),
};
