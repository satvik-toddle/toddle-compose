import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend runs on :4000 with a global `/api` prefix. In dev we proxy
// `/api` to it so the SPA can use same-origin relative URLs (no CORS, no
// hard-coded host). For non-proxied deploys set VITE_API_BASE_URL instead.
export default defineConfig({
  plugins: [react()],
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
});
