/** @type {import('tailwindcss').Config} */
// App-owned Tailwind build. @toddle-edu/ds-web is itself a Tailwind 3.4.17 build
// and already ships ~all of its utilities + the full Preflight compiled into
// dist/assets/main.css. This config exists only so OUR components can author
// utilities too — it deliberately emits utilities/components ONLY (no base, see
// corePlugins.preflight below) and mirrors the DS scale so `gap-3`, `rounded-2`,
// `text-size-400`, etc. render identically to the DS and flip in dark mode.
export default {
  // Scope to app source only. Do NOT scan ds-web/dist — those utilities already
  // ship compiled in main.css; scanning them would just double-emit.
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // Class strategy keyed on the SAME `.dark` selector the DS / ds-theme tokens
  // use (rbac.css: `.rbac.dark`, `.dark .rbac`). The default 'media' would
  // desync `dark:` utilities from the DS's class-based token flip. In practice
  // prefer token-driven colors (which flip automatically); this only governs
  // explicit `dark:` variants.
  darkMode: ['class', '.dark'],

  // P0 — DO NOT emit Preflight. ds-web main.css already ships the full Tailwind
  // v3 Preflight (the `--tw-*` base block + the h1..h6 `font-weight:inherit`
  // reset) and antd.css ships its own reset on top. A second Preflight would
  // re-break antd 4 controls and undo the app's own h1..h6/body restoration in
  // src/styles/index.css. We emit components + utilities only.
  corePlugins: { preflight: false },

  // Match the DS build flags: no prefix, no global important (per-utility `!`
  // still works). Keeps our class names identical to the DS's.
  prefix: '',
  important: false,

  // No @tailwindcss/forms — its resets are already compiled into DS main.css;
  // re-adding it would double-emit the same form globals.
  plugins: [],

  theme: {
    extend: {
      fontFamily: {
        avenirNext: [
          'AvenirNext',
          'Avenir Next',
          'AvenirNextWorld',
          'Arial',
          'sans-serif',
          'system-ui',
        ],
        nunito: ['Nunito'],
      },

      // Token-CSS-var driven so they flip with the DS token theme. Keys mirror
      // the DS @apply usage (text-size-*, leading-*, font-weight-*).
      fontSize: {
        'size-25': 'var(--font-size-25)',
        'size-50': 'var(--font-size-50)',
        'size-75': 'var(--font-size-75)',
        'size-100': 'var(--font-size-100)',
        'size-200': 'var(--font-size-200)',
        'size-300': 'var(--font-size-300)',
        'size-400': 'var(--font-size-400)',
        'size-500': 'var(--font-size-500)',
        'size-600': 'var(--font-size-600)',
        'size-700': 'var(--font-size-700)',
        'size-800': 'var(--font-size-800)',
      },
      lineHeight: {
        '00': 'var(--line-height-00)',
        75: 'var(--line-height-75)',
        100: 'var(--line-height-100)',
        200: 'var(--line-height-200)',
        300: 'var(--line-height-300)',
        400: 'var(--line-height-400)',
        500: 'var(--line-height-500)',
        600: 'var(--line-height-600)',
        700: 'var(--line-height-700)',
      },
      fontWeight: {
        'weight-400': 'var(--font-weight-400)',
        'weight-500': 'var(--font-weight-500)',
        'weight-600': 'var(--font-weight-600)',
        'weight-700': 'var(--font-weight-700)',
      },

      // Literal px to match the DS (its spacing utilities emit literal px, not
      // rem/--space-* tokens; keeping px avoids divergence if root font-size
      // ever changes). Integer steps coincide with Tailwind defaults; the
      // fractional and large steps (0.25, 2.25, 120, 140, 170) are DS-specific.
      spacing: {
        0: '0px',
        0.25: '1px',
        0.5: '2px',
        0.75: '3px',
        1: '4px',
        1.5: '6px',
        2: '8px',
        2.25: '9px',
        2.5: '10px',
        2.625: '10.5px',
        2.75: '11px',
        3: '12px',
        3.25: '13px',
        3.5: '14px',
        4: '16px',
        5: '20px',
        5.5: '22px',
        6: '24px',
        6.5: '26px',
        7: '28px',
        7.5: '30px',
        8: '32px',
        9: '36px',
        10: '40px',
        10.5: '42px',
        11: '44px',
        12: '48px',
        12.5: '50px',
        13: '52px',
        14: '56px',
        14.5: '58px',
        16: '64px',
        18: '72px',
        20: '80px',
        24: '96px',
        26: '104px',
        28: '112px',
        32: '128px',
        36: '144px',
        40: '160px',
        44: '176px',
        48: '192px',
        51: '204px',
        52: '208px',
        54: '216px',
        56: '224px',
        60: '240px',
        64: '256px',
        66: '264px',
        68: '272px',
        70: '280px',
        72: '288px',
        80: '320px',
        96: '384px',
        120: '480px',
        140: '560px',
        170: '680px',
      },

      borderRadius: {
        0: '0px',
        0.5: '2px',
        0.625: '2.5px',
        0.75: '3px',
        1: '4px',
        1.5: '6px',
        2: '8px',
        2.5: '10px',
        3: '12px',
        4: '16px',
        full: '100px',
      },
      borderWidth: { 1: '1px', 2: '2px' },
      ringWidth: { 1.5: '1.5px' },

      boxShadow: {
        'elevation-1-right': 'var(--elevation-1-right)',
        'elevation-1-left': 'var(--elevation-1-left)',
        'elevation-2-bottom': 'var(--elevation-2-bottom)',
        'elevation-3-bottom': 'var(--elevation-3-bottom)',
        'elevation-4-bottom': 'var(--elevation-4-bottom)',
      },

      // Color note: the DS's semantic, dark-mode-aware color utilities
      // (text-primary, bg-surface-primary-enabled, border-secondary, icon-hover,
      // …) are already shipped compiled in ds-web main.css — author them in
      // className directly; they flip under .dark for free. We intentionally do
      // NOT re-declare a parallel color palette here (that risks token drift and
      // hard hex colors that don't flip). If app code needs a specific named
      // color as a Tailwind token, map THAT one to its DS var so it stays
      // dark-aware, e.g.:
      //   colors: { 'surface-primary': 'var(--surface-primary-enabled)' }
      colors: {},
    },
  },
};
