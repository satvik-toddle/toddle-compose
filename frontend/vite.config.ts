import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow the app to be served through tunnels (e.g. *.ngrok-free.app);
    // Vite 5.4+ rejects unknown Host headers by default.
    allowedHosts: true,
    // Single-origin hosting: proxy the API and the RTC WebSocket to the local
    // backend/rtc-server so everything (incl. uploaded files) is served from
    // the frontend's origin. Through ngrok this means one tunnel/one origin —
    // sidestepping the per-domain browser-warning interstitial for sub-resources
    // like <img src> pointing at uploaded files.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/yjs': { target: 'ws://localhost:4001', ws: true, changeOrigin: true },
      // Authoritative cell-lock channel — same rtc-server, separate WS path.
      '/locks': { target: 'ws://localhost:4001', ws: true, changeOrigin: true },
    },
  },
  // @toddle-edu/ds-doc-editor and @toddle-edu/ds-data-grid are linked CommonJS
  // packages (live outside node_modules). Vite skips CommonJS handling for such
  // paths by default, which breaks their named exports — opt them in for both
  // dev pre-bundling and the production CommonJS transform.
  // Force a single copy of react/yjs across the app and the linked editor
  // (otherwise "Yjs was already imported" / duplicate React breaks collab).
  // ds-data-grid externalizes react/react-dom/lodash and the other @toddle-edu
  // DS packages (ds-web, ds-icons), so dedupe them to the frontend's copies —
  // the design-system repo ships slightly newer ds-web/ds-icons and we want a
  // single copy (shared React context + styles) rather than two.
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'lodash',
      '@toddle-edu/ds-web',
      '@toddle-edu/ds-icons',
    ],
  },
  // The editor bundles + re-exports its own yjs/y-websocket; the app imports
  // them from the editor, so there is only one yjs copy. Pre-bundle the linked
  // packages themselves (they're linked CommonJS packages).
  optimizeDeps: {
    include: ['@toddle-edu/ds-doc-editor', '@toddle-edu/ds-data-grid'],
  },
  build: {
    commonjsOptions: {
      include: [/doc-editor/, /ds-data-grid/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
});
