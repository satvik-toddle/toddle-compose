// RTC WebSocket base URL. By default we follow the PAGE ORIGIN and let Vite
// proxy `/yjs` to the rtc-server (see vite.config.ts) — single-origin hosting,
// so it works unchanged on localhost and through any tunnel (ngrok, etc.)
// without hardcoding a host. Set VITE_RTC_WS_URL only to point RTC at a
// different origin than the frontend.
function defaultRtcWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:4001';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

export const env = {
  rtcWsUrl: (import.meta as any).env?.VITE_RTC_WS_URL || defaultRtcWsUrl(),
};
