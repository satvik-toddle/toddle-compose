import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { REQUIRED_ENV_KEYS } from './src/lib/env-keys';

// Both env vars are required in every mode — dev defaults are committed in .env.development, deploys set real values via build env vars.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const missing = REQUIRED_ENV_KEYS.filter((name) => !env[name]);
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
