import type { RequiredEnvKey } from './env-keys';

// Fail fast at module load if a required var is missing — vite.config.ts enforces the same contract at build/dev startup.
function requireEnv(name: RequiredEnvKey): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Base URL for API calls, e.g. http://localhost:4000 (dev default lives in frontend/.env.development).
export const API_BASE: string = requireEnv('VITE_API_BASE_URL');

// All backend routes are mounted under the global `/api` prefix.
export const API_PREFIX = '/api';

// rtc-server WebSocket base for Yjs collaboration; it only upgrades on `/yjs/<docId>`, so append `/yjs` when the configured value omits it.
const RTC_WS_BASE = requireEnv('VITE_RTC_WS_URL').replace(/\/+$/, '');
export const RTC_WS_URL: string = /\/yjs$/.test(RTC_WS_BASE) ? RTC_WS_BASE : `${RTC_WS_BASE}/yjs`;

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${API_PREFIX}${p}`;
}
