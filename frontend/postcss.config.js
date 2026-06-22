// Standalone PostCSS config — Vite auto-detects it, so vite.config.ts (which
// holds css.modules.localsConvention and the manualChunks vendor-ds split) is
// left untouched. Order matters: Tailwind runs first, then autoprefixer.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
