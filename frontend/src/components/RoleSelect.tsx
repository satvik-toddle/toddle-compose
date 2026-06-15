import type { ComponentType, ReactNode } from 'react';
import { SelectDropdown } from '@toddle-edu/ds-web';
import { Icon } from './Icon';
import { cn } from '../lib/cn';

// The version-switching selector's union type drops some react-select props
// (value/onChange/formatOptionLabel); use it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Select = SelectDropdown as unknown as ComponentType<any>;

export interface RoleOption<T extends string> {
  value: T;
  label: string;
}

export interface RoleSelectProps<T extends string> {
  value: T;
  options: RoleOption<T>[];
  onChange: (v: T) => void;
  renderValue: (v: T) => ReactNode; // the visible chip
  disabled?: boolean;
  locked?: boolean; // shows the chip + a lock, no dropdown
}

// Inline role picker backed by ds-web SelectDropdown; each option/value renders
// as our role chip via formatOptionLabel. Locked rows show the chip + a lock.
export function RoleSelect<T extends string>({
  value,
  options,
  onChange,
  renderValue,
  disabled,
  locked,
}: RoleSelectProps<T>) {
  if (locked || disabled) {
    return (
      <span className={cn('role-dd', 'locked')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {renderValue(value)}
        <Icon name="LockOutlined" size={14} />
      </span>
    );
  }
  const opts = options.map((o) => ({ label: o.label, value: o.value }));
  return (
    <div style={{ minWidth: 150 }}>
      <Select
        options={opts}
        value={opts.find((o) => o.value === value)}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={(opt: any) => opt && onChange(opt.value as T)}
        isSearchable={false}
        isClearable={false}
        size="small"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatOptionLabel={(opt: any) => renderValue(opt.value as T)}
      />
    </div>
  );
}
