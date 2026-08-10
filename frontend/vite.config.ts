import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { REQUIRED_ENV_KEYS } from './src/lib/env-keys';

// Both env vars are required in every mode — dev defaults are committed in .env.development, deploys set real values via build env vars.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let missing = REQUIRED_ENV_KEYS.filter((name) => !env[name]);
  // Local (non-CI) builds fall back to the committed dev defaults so `vite build`/`preview` work without exports; CI deploys must set real values.
  if (missing.length > 0 && !process.env.CI) {
    const devEnv = loadEnv('development', process.cwd(), '');
    // Writing to process.env (not just the local copy) is what makes Vite pick the values up for the bundle.
    for (const name of missing) if (devEnv[name]) process.env[name] = devEnv[name];
    missing = missing.filter((name) => !process.env[name]);
    if (missing.length === 0) {
      console.warn(`[vite] falling back to .env.development defaults for ${mode} build — set ${REQUIRED_ENV_KEYS.join(', ')} to override.`);
    }
  }
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
      // Fail instead of falling back to 5174 — the backend CORS allowlist only covers :5173.
      strictPort: true,
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
