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
    },
  },
  // @toddle-edu/ds-doc-editor is a linked UMD package (lives outside
  // node_modules). Vite skips CommonJS handling for such paths by default,
  // which breaks its named exports — opt it in for both dev pre-bundling and
  // the production CommonJS transform.
  // Force a single copy of react/yjs across the app and the linked editor
  // (otherwise "Yjs was already imported" / duplicate React breaks collab).
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // The editor bundles + re-exports its own yjs/y-websocket; the app imports
  // them from the editor, so there is only one yjs copy. Just pre-bundle the
  // editor itself (it's a linked UMD package).
  optimizeDeps: {
    include: ['@toddle-edu/ds-doc-editor'],
  },
  build: {
    commonjsOptions: {
      include: [/doc-editor/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
});
