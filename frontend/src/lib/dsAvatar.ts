// ds-web Avatar takes a NAMED color enum + size enum (not the brand hex / pixels),
// so we map the brand palette + our numeric sizes to the nearest ds-web token.
type DsColor =
  | 'violet' | 'blue' | 'yellow' | 'pink' | 'teal'
  | 'purple' | 'green' | 'orange' | 'red' | 'neutral';
type DsSize = 'xxx-small' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'large' | 'x-large';

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
  '#f04c54': 'red',
};

export function dsAvatarColor(hex?: string): DsColor {
  return (hex && COLOR_BY_HEX[hex.toLowerCase()]) || 'neutral';
}

export function dsAvatarSize(px: number): DsSize {
  if (px <= 16) return 'xxx-small';
  if (px <= 22) return 'xx-small';
  if (px <= 26) return 'x-small';
  if (px <= 32) return 'small';
  if (px <= 40) return 'medium';
  return 'large';
}
