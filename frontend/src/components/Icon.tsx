import type { CSSProperties } from 'react';
import { cn } from '../lib/cn';
import { ICONS, type IconName } from './iconMap';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24;

// muted/red/white map to a CSS color; the ds-icons SVG paths use
// fill: currentColor (the `.fill-current` rule in rbac.css), so setting `color`
// drives the fill. Default (none set) inherits the surrounding text color.
const COLOR = {
  muted: 'var(--text-secondary)',
  red: 'var(--text-semantic-error)',
  white: 'var(--neutral-white)',
} as const;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** secondary/grey */ muted?: boolean;
  /** error red */ red?: boolean;
  /** white */ white?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Renders a ds-icons SVG, sized + colored inline. The `.ic` marker class is kept
// only so context styles (e.g. dimmed icons) can target it; size and color are
// inline so no per-size CSS classes are needed. A caller-supplied `style` wins.
export function Icon({ name, size = 14, muted, red, white, className, style }: IconProps) {
  const C = ICONS[name];
  if (!C) return null;
  const color = muted ? COLOR.muted : red ? COLOR.red : white ? COLOR.white : undefined;
  return (
    <C
      className={cn('ic', className)}
      style={{ width: size, height: size, flex: 'none', display: 'block', color, ...style }}
      aria-hidden
    />
  );
}

export type { IconName };
