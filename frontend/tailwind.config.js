/** @type {import('tailwindcss').Config} */
// App-owned Tailwind build. ds-web is itself a Tailwind 3.4.17 build that already
// ships its utilities + Preflight in dist/assets/main.css; this exists only so our
// components can author utilities too, mirroring the DS scale. Utilities only — no
// base (preflight is off below).
export default {
  // App source only — don't scan ds-web/dist (already compiled in main.css).
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // Match the DS's class-based dark flip (`.dark`), not the default 'media'.
  // Governs explicit `dark:` variants only; token colors flip on their own.
  darkMode: ['class', '.dark'],

  // P0: never emit Preflight. ds-web main.css + antd.css already ship resets; a
  // second one re-breaks antd and undoes our index.css typography.
  corePlugins: { preflight: false },

  // Match the DS build: no prefix, no global important (per-utility `!` still works).
  prefix: '',
  important: false,

  // No @tailwindcss/forms — already compiled into DS main.css.
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

      // CSS-var driven so they flip with the DS theme; keys mirror DS @apply names.
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

      // Literal px to match the DS's spacing utilities. Fractional/large steps
      // (0.25, 2.25, 120, 140, 170) are DS-specific; integers match Tailwind.
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

      // No parallel palette: the DS's dark-aware color utilities (text-primary,
      // bg-surface-*, …) are compiled in main.css — author them directly. To add a
      // named color, map it to its DS var, e.g. 'surface-primary': 'var(--surface-primary-enabled)'.
      colors: {},
    },
  },
};
