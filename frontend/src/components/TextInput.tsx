import type { InputHTMLAttributes, ReactElement, ReactNode, SyntheticEvent } from 'react';
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
      leadingIcon={icon ? <Icon name={icon} size={14} muted /> : undefined}
      trailingIcon={(trailing as ReactElement) ?? undefined}
      // ds-web renders the trailing icon in a native <button> with no type attr,
      // which defaults to type="submit" — so inside a <form> a tap would submit it
      // (e.g. the password eye toggle logging the user in). Swallow the default.
      onTrailingIconClick={
        onTrailingClick
          ? (e?: SyntheticEvent) => {
              e?.preventDefault?.();
              onTrailingClick();
            }
          : undefined
      }
      error={err ? ' ' : undefined}
      type={dsType}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size={(sm ? 'small' : 'medium') as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(rest as any)}
    />
  );
}
