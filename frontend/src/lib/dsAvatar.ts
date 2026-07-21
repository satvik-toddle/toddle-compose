// Map brand hex + numeric size to ds-web's named color/size enums.
type DsColor =
  | 'violet' | 'blue' | 'yellow' | 'pink' | 'teal'
  | 'purple' | 'green' | 'orange' | 'red' | 'neutral';
type DsSize = 'xxx-small' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'large' | 'x-large';

// Brand hex → DS hue. red is omitted (reserved for CTA/error), so it rotates below.
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

// Fallback hues for unknown hexes; excludes red and neutral.
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

// djb2 — stable hash so a person always maps to the same hue.
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Known hex wins; else deterministic rotation by seed; else neutral.
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
