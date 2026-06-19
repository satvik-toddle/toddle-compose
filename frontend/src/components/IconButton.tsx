import type { ButtonHTMLAttributes } from 'react';
import { Button as DsButton } from '@toddle-edu/ds-web';
import { Icon, type IconName, type IconSize } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconName;
  iconSize?: IconSize;
  muted?: boolean;
  red?: boolean;
  sm?: boolean;
}

// Icon-only ds-web Button (plain style).
export function IconButton({ icon, iconSize = 14, muted = true, red, sm, ...rest }: IconButtonProps) {
  return (
    <DsButton
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variant={(red ? 'destructive' : 'neutral') as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type={'plain' as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={'small' as any}
      icon={<Icon name={icon} size={iconSize} red={red} muted={muted && !red} />}
      {...rest}
    />
  );
}
