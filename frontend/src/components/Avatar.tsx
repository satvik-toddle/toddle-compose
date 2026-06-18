import type { CSSProperties, ReactNode } from 'react';
import { Avatar as DsAvatar } from '@toddle-edu/ds-web';
import { dsAvatarColor, dsAvatarSize } from '../lib/dsAvatar';

export interface AvatarPerson {
  name?: string;
  color?: string;
  initials?: string;
}

export interface AvatarProps {
  person?: AvatarPerson;
  color?: string;
  children?: ReactNode;
  size?: number;
  ring?: boolean;
  style?: CSSProperties;
}

// ds-web Avatar (named color + size enum; exact brand hex / px are mapped to the
// nearest token). Initials are derived by ds-web from `name`.
export function Avatar({ person, color, children, size = 26 }: AvatarProps) {
  const hex = color || person?.color;
  const name =
    person?.name ||
    (typeof children === 'string' ? children : '') ||
    person?.initials ||
    '?';
  return (
    <DsAvatar
      name={name}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      color={dsAvatarColor(hex) as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={dsAvatarSize(size) as any}
      shape="circle"
    />
  );
}
