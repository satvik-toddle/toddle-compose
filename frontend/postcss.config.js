// Standalone config (Vite auto-detects it) so vite.config.ts stays untouched.
// Order matters: Tailwind first, then autoprefixer.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
