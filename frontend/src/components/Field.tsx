import type { ReactNode } from 'react';

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
    <label className="field">
      {label && <span>{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
