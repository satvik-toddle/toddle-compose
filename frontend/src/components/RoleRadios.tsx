import type { ReactNode } from 'react';
import { RadioButton } from '@toddle-edu/ds-web';
import { cn } from '../lib/cn';

export interface RoleRadioOption<T extends string> {
  value: T;
  title?: ReactNode; // realm style: title + desc block
  desc?: ReactNode;
  chip?: ReactNode; // workspace style: chip + desc inline
}

export function RoleRadios<T extends string>({
  value,
  onChange,
  options,
  cols,
}: {
  value: T;
  onChange: (v: T) => void;
  options: RoleRadioOption<T>[];
  cols?: boolean;
}) {
  return (
    <div className={cn('role-radios', cols && 'cols')} role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} className={cn('role-opt', on && 'on')} onClick={() => onChange(o.value)}>
            <RadioButton
              checked={on}
              onChange={() => onChange(o.value)}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              size={'small' as any}
              name={`role-${String(o.value)}`}
            />
            {o.chip}
            {o.title ? (
              <div>
                <div className="ttl">{o.title}</div>
                {o.desc && <div className="ds">{o.desc}</div>}
              </div>
            ) : (
              o.desc && (
                <span className="ds" style={{ marginLeft: 2 }}>
                  {o.desc}
                </span>
              )
            )}
          </label>
        );
      })}
    </div>
  );
}
