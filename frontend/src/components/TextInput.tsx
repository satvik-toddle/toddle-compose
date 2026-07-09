import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import { TextInput as DsTextInput } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: IconName;
  err?: boolean;
  sm?: boolean;
  // A trailing icon ELEMENT (never a <button> — ds-web wraps it in its own
  // button, and a nested button corrupts the DOM). Use onTrailingClick for taps.
  trailing?: ReactNode;
  onTrailingClick?: () => void;
  wrapClassName?: string;
}

// ds-web TextInput. onChange is a standard ChangeEvent (matches our callers).
// ds-web only supports type text/password, so map anything else (e.g. email) to text.
export function TextInput({
  icon,
  err,
  sm,
  trailing,
  onTrailingClick,
  wrapClassName,
  className,
  type,
  ...rest
}: TextInputProps) {
  const dsType = type === 'password' ? 'password' : 'text';
  return (
    <DsTextInput
      dsVersion="2.0"
      leadingIcon={icon ? <Icon name={icon} size={14} muted /> : undefined}
      trailingIcon={(trailing as ReactElement) ?? undefined}
      onTrailingIconClick={onTrailingClick ? () => onTrailingClick() : undefined}
      error={err ? ' ' : undefined}
      type={dsType}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={(sm ? 'small' : 'medium') as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(rest as any)}
    />
  );
}
