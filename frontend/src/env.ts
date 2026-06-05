export const env = {
  rtcWsUrl: (import.meta as any).env?.VITE_RTC_WS_URL ?? 'ws://localhost:4001',
};
