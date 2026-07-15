import { DEFAULT_THEME, type TLDefaultColor, type TLFontFace, type TLTheme } from 'tldraw';
import avenirRegular from '@toddle-edu/ds-web/dist/assets/fonts/AvenirNextWorld/AvenirNextWorld-Regular.ttf';
import avenirItalic from '@toddle-edu/ds-web/dist/assets/fonts/AvenirNextWorld/AvenirNextWorld-Italic.ttf';
import avenirBold from '@toddle-edu/ds-web/dist/assets/fonts/AvenirNextWorld/AvenirNextWorld-Bold.ttf';
import avenirDemiItalic from '@toddle-edu/ds-web/dist/assets/fonts/AvenirNextWorld/AvenirNextWorld-DemiIt.ttf';

// Toddle DS brand hexes mapped onto tldraw's color names. Only hex values
// change — keeping tldraw's names leaves the synced store schema untouched.
// light ≈ *-500 token, dark ≈ brighter *-600; black/white keep tldraw defaults.
const BRAND: Record<string, { light: string; dark: string }> = {
  grey: { light: '#8f8f8f', dark: '#adadad' }, // neutral
  'light-violet': { light: '#da8fff', dark: '#e7b9fe' }, // purple-700/800
  violet: { light: '#b646ee', dark: '#cc66ff' }, // purple
  blue: { light: '#6a6af5', dark: '#8585ff' }, // violet token (indigo)
  'light-blue': { light: '#00b0c2', dark: '#00c9e0' }, // blue token (cyan)
  yellow: { light: '#d67d00', dark: '#ffaa00' },
  orange: { light: '#e8653a', dark: '#ff865d' },
  green: { light: '#00ac8a', dark: '#04d4aa' }, // teal token
  'light-green': { light: '#6d9c00', dark: '#8bc011' }, // green token (lime)
  'light-red': { light: '#ef4371', dark: '#ff5c88' }, // pink
  red: { light: '#f04c54', dark: '#ff6169' },
};

const LIGHT_BG = '#f9fafb';
const DARK_BG = '#0f0f11';

// t = weight of b
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  let out = '#';
  for (const shift of [16, 8, 0]) {
    const v = Math.round(((pa >> shift) & 0xff) * (1 - t) + ((pb >> shift) & 0xff) * t);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

function lightVariants(hex: string): TLDefaultColor {
  return {
    solid: hex,
    fill: hex,
    linedFill: mix(hex, '#ffffff', 0.18),
    semi: mix(hex, LIGHT_BG, 0.8),
    pattern: mix(hex, '#ffffff', 0.12),
    frameHeadingStroke: mix(hex, '#ffffff', 0.25),
    frameHeadingFill: mix(hex, '#ffffff', 0.95),
    frameStroke: mix(hex, '#ffffff', 0.25),
    frameFill: mix(hex, '#ffffff', 0.96),
    frameText: '#000000',
    noteFill: mix(hex, '#ffffff', 0.45),
    noteText: '#000000',
    highlightSrgb: mix(hex, '#ffffff', 0.35),
    highlightP3: mix(hex, '#ffffff', 0.35),
  };
}

function darkVariants(hex: string): TLDefaultColor {
  return {
    solid: hex,
    fill: hex,
    linedFill: mix(hex, '#000000', 0.15),
    semi: mix(hex, DARK_BG, 0.82),
    pattern: mix(hex, DARK_BG, 0.35),
    frameHeadingStroke: mix(hex, DARK_BG, 0.55),
    frameHeadingFill: mix(hex, DARK_BG, 0.85),
    frameStroke: mix(hex, DARK_BG, 0.55),
    frameFill: mix(hex, DARK_BG, 0.92),
    frameText: '#f2f2f2',
    noteFill: mix(hex, '#000000', 0.45),
    noteText: '#f2f2f2',
    highlightSrgb: mix(hex, '#000000', 0.25),
    highlightP3: mix(hex, '#000000', 0.25),
  };
}

const byMode = (mode: 'light' | 'dark') =>
  Object.fromEntries(
    Object.entries(BRAND).map(([name, c]) => [
      name,
      mode === 'light' ? lightVariants(c.light) : darkVariants(c.dark),
    ]),
  );

// Brand font for the default ("sans") text style. The same ttf files ds-web's
// @font-face uses; registering them as theme faces makes tldraw preload them
// and embed them in PNG/SVG exports. No Bold Italic cut exists — DemiIt (600)
// is the closest.
const avenirFace = (url: string, weight: string, style?: string): TLFontFace => ({
  family: 'AvenirNextWorld',
  src: { url, format: 'truetype' },
  weight,
  ...(style ? { style } : {}),
});

const AVENIR_SANS = {
  fontFamily: "'AvenirNextWorld', 'Avenir Next', sans-serif",
  faces: [
    avenirFace(avenirRegular, 'normal'),
    avenirFace(avenirBold, 'bold'),
    avenirFace(avenirItalic, 'normal', 'italic'),
    avenirFace(avenirDemiItalic, 'bold', 'italic'),
  ],
};

const whiteboardTheme: TLTheme = {
  ...DEFAULT_THEME,
  fonts: { ...DEFAULT_THEME.fonts, sans: AVENIR_SANS },
  colors: {
    light: { ...DEFAULT_THEME.colors.light, ...byMode('light') },
    dark: { ...DEFAULT_THEME.colors.dark, ...byMode('dark') },
  },
};

// Module-level so the reference is stable across renders (Tldraw re-registers
// themes when the prop identity changes).
export const WHITEBOARD_THEMES = { default: whiteboardTheme };

// Light-mode solids, used for nearest-color matching in the Zwibbler converter.
export const WHITEBOARD_SOLIDS: Record<string, string> = {
  black: '#1d1d1d',
  white: '#FFFFFF',
  ...Object.fromEntries(Object.entries(BRAND).map(([name, c]) => [name, c.light])),
};
