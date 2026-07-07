// Required env vars — fail fast at module load instead of silently falling
// back, so a misconfigured build/deploy surfaces immediately.
function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Base URL for API calls (e.g. http://localhost:4000). Set via VITE_API_BASE_URL.
export const API_BASE: string = requireEnv('VITE_API_BASE_URL');

// All backend routes are mounted under the global `/api` prefix.
export const API_PREFIX = '/api';

// rtc-server WebSocket endpoint for real-time document collaboration (Yjs).
// Set via VITE_RTC_WS_URL. The rtc-server only upgrades connections on the
// `/yjs/<docId>` path, so the base MUST end in `/yjs` (WebsocketProvider appends
// the room). Tolerate a value configured without it (e.g. `ws://localhost:4001`).
const RTC_WS_BASE = requireEnv('VITE_RTC_WS_URL').replace(/\/+$/, '');
export const RTC_WS_URL: string = /\/yjs$/.test(RTC_WS_BASE) ? RTC_WS_BASE : `${RTC_WS_BASE}/yjs`;

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${API_PREFIX}${p}`;
}
