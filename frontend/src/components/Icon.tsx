import type { CSSProperties } from 'react';
import { cn } from '../lib/cn';
import { ICONS, type IconName } from './iconMap';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24;

const SIZE_CLASS: Record<IconSize, string> = {
  12: 'ic-12',
  14: 'ic-14',
  16: 'ic',
  18: 'ic-18',
  20: 'ic-20',
  24: 'ic-24',
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** secondary/grey */ muted?: boolean;
  /** error red */ red?: boolean;
  /** white */ white?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Renders a ds-icons SVG. Color comes from `color` (currentColor) — defaults to
// the surrounding text color; size from our .ic-* classes.
export function Icon({ name, size = 14, muted, red, white, className, style }: IconProps) {
  const C = ICONS[name];
  if (!C) return null;
  const cls = cn(SIZE_CLASS[size], muted && 'ic-muted', red && 'ic-red', white && 'ic-white', className);
  return <C className={cls} style={style} aria-hidden />;
}

export type { IconName };
