import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
