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
  // Accepted for API compatibility. ds-web v2 Button uses its own `type` for visual
  // styling, so we drop it here — but it renders a native <button> with no HTML type
  // attribute, which defaults to type="submit". So a Button inside a <form> already
  // submits on click; do NOT also add onClick={submit} or the handler fires twice.
  type: _type,
  ...rest
}: ButtonProps) {
  void _type;
  const v = VARIANT[variant] ?? VARIANT[''];
  // ds-web "fill" buttons (primary/danger) paint a white label, but our injected
  // <Icon> renders in a separate slot that keeps the default dark icon color — so
  // force the icon white to match the label (otherwise the "+" looks black on red).
  const onFill = v.dsType === 'fill';
  return (
    <DsButton
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variant={v.variant as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type={v.dsType as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={SIZE[size] as any}
      isFullWidth={block}
      icon={icon ? <Icon name={icon} size={14} white={onFill} /> : undefined}
      rightIcon={iconRight ? <Icon name={iconRight} size={14} white={onFill} /> : undefined}
      {...rest}
    >
      {children}
    </DsButton>
  );
}
