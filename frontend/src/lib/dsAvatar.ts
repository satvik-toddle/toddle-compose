// ds-web Avatar takes a NAMED color enum + size enum (not the brand hex / pixels),
// so we map the brand palette + our numeric sizes to the nearest ds-web token.
type DsColor =
  | 'violet' | 'blue' | 'yellow' | 'pink' | 'teal'
  | 'purple' | 'green' | 'orange' | 'red' | 'neutral';
type DsSize = 'xxx-small' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'large' | 'x-large';

// Known brand identity hexes (assigned at signup) → the matching DS avatar hue, so a
// user's chosen colour carries through. `red` (#f04c54) is intentionally NOT mapped: the
// DS red is the --interactive-primary / destructive hue reserved for CTAs and error
// states, so a red identity would render an avatar that reads as an error. Those fall
// through to the decorative rotation below instead.
const COLOR_BY_HEX: Record<string, DsColor> = {
  '#5a5ae2': 'violet',
  '#00ac8a': 'teal',
  '#ef4371': 'pink',
  '#d67d00': 'yellow',
  '#6d9c00': 'green',
  '#00b0c2': 'blue',
  '#b646ee': 'purple',
  '#e8653a': 'orange',
  '#a43dd7': 'purple',
};

// Decorative hues for data/owner avatars that have no known brand hex. Excludes `neutral`
// (so unknown-colour avatars aren't an indistinct grey) and `red` (reserved, see above).
// All are theme-aware in the DS (--decorative-background-subtle-{hue} flips light/dark).
const AVATAR_HUES: readonly DsColor[] = [
  'violet',
  'blue',
  'teal',
  'green',
  'yellow',
  'orange',
  'pink',
  'purple',
];

// Small deterministic string hash (djb2, unsigned) — stable across sessions/reloads so a
// given person always maps to the same hue.
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Resolve a DS avatar hue: a known brand hex wins; otherwise rotate deterministically over
// the decorative hues using a stable `seed` (a user/owner id, or name when no id exists).
// Only when neither a known hex nor a seed is available do we fall back to neutral grey.
export function dsAvatarColor(hex?: string, seed?: string): DsColor {
  const known = hex ? COLOR_BY_HEX[hex.toLowerCase()] : undefined;
  if (known) return known;
  if (seed) return AVATAR_HUES[hashSeed(seed) % AVATAR_HUES.length];
  return 'neutral';
}

export function dsAvatarSize(px: number): DsSize {
  if (px <= 16) return 'xxx-small';
  if (px <= 22) return 'xx-small';
  if (px <= 26) return 'x-small';
  if (px <= 32) return 'small';
  if (px <= 40) return 'medium';
  return 'large';
}
