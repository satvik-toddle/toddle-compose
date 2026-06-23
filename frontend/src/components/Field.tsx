import type { ReactNode } from 'react';
import s from './Field.module.scss';

export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={s.field}>
      {label && <span>{label}</span>}
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  );
}
