// Base URL for API calls. Empty string means "use the Vite dev proxy" (same
// origin → /api/...). Set VITE_API_BASE_URL for a non-proxied deployment.
export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? '';

// All backend routes are mounted under the global `/api` prefix.
export const API_PREFIX = '/api';

// rtc-server WebSocket endpoint for real-time document collaboration (Yjs).
// Default to the local dev rtc-server; override per deploy with VITE_RTC_WS_URL.
// The rtc-server only upgrades connections on the `/yjs/<docId>` path, so the
// base MUST end in `/yjs` (WebsocketProvider appends the room). Tolerate a value
// configured without it (e.g. `ws://localhost:4001`) so it still connects.
const RTC_WS_BASE = (import.meta.env.VITE_RTC_WS_URL ?? 'ws://localhost:4001/yjs').replace(/\/+$/, '');
export const RTC_WS_URL: string = /\/yjs$/.test(RTC_WS_BASE) ? RTC_WS_BASE : `${RTC_WS_BASE}/yjs`;

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${API_PREFIX}${p}`;
}
