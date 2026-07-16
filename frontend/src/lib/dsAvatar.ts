// ds-web Avatar takes a NAMED color enum + size enum (not the brand hex / pixels),
// so we map the brand palette + our numeric sizes to the nearest ds-web token.
type DsColor =
  | 'violet' | 'blue' | 'yellow' | 'pink' | 'teal'
  | 'purple' | 'green' | 'orange' | 'red' | 'neutral';
type DsSize = 'xxx-small' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'large' | 'x-large';

// Brand identity hexes → DS avatar hue. red (#f04c54) is omitted deliberately: it's the
// CTA/destructive colour, so red identities rotate below instead of reading as an error.
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

// Decorative avatar hues for unknown brand hexes; excludes red (reserved) and neutral (grey).
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
