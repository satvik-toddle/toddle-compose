import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { IconButton as DsIconButton } from '@toddle-edu/ds-web';
import { Icon, type IconName, type IconSize } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconName;
  iconSize?: IconSize;
  muted?: boolean;
  red?: boolean;
  sm?: boolean;
}

// Icon-only ds-web IconButton (plain style), keyed by our IconName map.
export function IconButton({ icon, iconSize = 14, muted = true, red, sm, ...rest }: IconButtonProps) {
  return (
    <DsIconButton
      dsVersion="2.0"
      variant={red ? 'destructive' : 'neutral'}
      type="plain"
      size={sm ? 'x-small' : 'small'}
      icon={(<Icon name={icon} size={iconSize} red={red} muted={muted && !red} />) as ReactElement}
      {...rest}
    />
  );
}
