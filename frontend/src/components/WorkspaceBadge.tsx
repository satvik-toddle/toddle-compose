import type { CSSProperties } from 'react';
import { Icon, type IconSize } from './Icon';
import { workspaceVisual } from '../lib/workspaceVisual';
import { cn } from '../lib/cn';

// Colored, rounded workspace icon chip derived deterministically from the id.
export function WorkspaceBadge({
  id,
  size = 38,
  iconSize = 18,
  className,
  style,
}: {
  id: string;
  size?: number;
  iconSize?: IconSize;
  className?: string;
  style?: CSSProperties;
}) {
  const v = workspaceVisual(id);
  return (
    <span
      className={cn('flex flex-none items-center justify-center', className)}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? 12 : 10,
        background: `var(--tag-background-${v.hue}-default)`,
        ...style,
      }}
    >
      <Icon name={v.icon} size={iconSize} style={{ color: `var(--tag-foreground-${v.hue})` }} />
    </span>
  );
}
