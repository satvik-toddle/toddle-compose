import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const REQUIRED_ENV_VARS = ['VITE_API_BASE_URL', 'VITE_RTC_WS_URL'] as const;

// The backend runs on :4000 with a global `/api` prefix. In dev we proxy
// `/api` to it so the SPA can use same-origin relative URLs (no CORS, no
// hard-coded host). For non-proxied deploys set VITE_API_BASE_URL instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    plugins: [react()],
    css: {
      modules: {
        // Export camelCase keys (.ad-subbar → classes.adSubbar) so co-located
        // *.module.scss files are consumed the same way web-app does
        // (`import classes from './X.module.scss'; classes.someClass`).
        localsConvention: 'camelCaseOnly',
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Keep ds-web + antd in one chunk — otherwise Rollup splits antd's
          // ConfigContext across chunks (circular-chunk warning / broken order).
          manualChunks(id) {
            if (/node_modules\/(antd|rc-|@toddle-edu\/ds-web)/.test(id)) return 'vendor-ds';
          },
        },
      },
    },
  };
});
