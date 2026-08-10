/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Non-optional: vite.config.ts refuses to build/serve without them (keys listed in src/lib/env-keys.ts).
  readonly VITE_API_BASE_URL: string;
  readonly VITE_RTC_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
