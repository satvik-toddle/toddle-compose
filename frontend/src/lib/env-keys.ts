// Single source of truth for required frontend env vars — consumed by vite.config.ts (build/dev gate) and src/lib/env.ts (runtime reads).
export const REQUIRED_ENV_KEYS = ['VITE_API_BASE_URL', 'VITE_RTC_WS_URL'] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];
