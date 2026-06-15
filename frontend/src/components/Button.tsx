import type { ButtonHTMLAttributes } from 'react';
import { Button as DsButton } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';

// Map our design variants → ds-web v2 (variant = intent, type = visual style).
const VARIANT: Record<string, { variant: string; dsType: string }> = {
  primary: { variant: 'primary', dsType: 'fill' },
  danger: { variant: 'destructive', dsType: 'fill' },
  ghost: { variant: 'neutral', dsType: 'plain' },
  '': { variant: 'neutral', dsType: 'outlined' },
};
const SIZE: Record<string, string> = { sm: 'small', lg: 'large', '': 'medium' };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'ghost' | 'danger' | '';
  size?: 'sm' | 'lg' | '';
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  // Our HTML semantic (submit forms). ds-web v2 Button uses `type` for styling,
  // so we submit the enclosing form programmatically instead.
  type?: 'button' | 'submit' | 'reset';
}

export function Button({
  variant = '',
  size = '',
  icon,
  iconRight,
  block,
  children,
  // Accepted for API compatibility; ds-web v2 Button has no HTML submit type, so
  // forms wire submission via onClick (see auth pages). `type` is otherwise unused.
  type: _type,
  ...rest
}: ButtonProps) {
  void _type;
  const v = VARIANT[variant] ?? VARIANT[''];
  return (
    <DsButton
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variant={v.variant as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type={v.dsType as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={SIZE[size] as any}
      isFullWidth={block}
      icon={icon ? <Icon name={icon} size={14} /> : undefined}
      rightIcon={iconRight ? <Icon name={iconRight} size={14} /> : undefined}
      {...rest}
    >
      {children}
    </DsButton>
  );
}
