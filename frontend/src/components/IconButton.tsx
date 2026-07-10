import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { IconButton as DsIconButton, type IconButtonProps as DsIconButtonProps } from '@toddle-edu/ds-web';
import { Icon, type IconName, type IconSize } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconName;
  iconSize?: IconSize;
  muted?: boolean;
  red?: boolean;
  sm?: boolean;
  variant?: DsIconButtonProps['variant'];
  type?: DsIconButtonProps['type'];
}

// Icon-only ds-web IconButton (plain style), keyed by our IconName map.
export function IconButton({ icon, iconSize = 14, muted = true, red, sm, variant, type = 'plain', ...rest }: IconButtonProps) {
  // An explicit variant/type opts into ds-web's icon-color classes; our inline color would beat them.
  const dsColors = Boolean(variant) || type !== 'plain';
  return (
    <DsIconButton
      dsVersion="2.0"
      variant={variant ?? (red ? 'destructive' : 'neutral')}
      type={type}
      size={sm ? 'x-small' : 'small'}
      icon={(<Icon name={icon} size={iconSize} red={!dsColors && red} muted={!dsColors && muted && !red} />) as ReactElement}
      {...rest}
    />
  );
}
