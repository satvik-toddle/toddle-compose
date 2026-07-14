import { Fragment, type ReactNode } from 'react';

// Wrap every case-insensitive occurrence of `q` inside `t` in a highlight <mark>.
// Ported verbatim from the design source; used for both list titles and snippets.
export function Hit({ t, q }: { t: string; q: string }) {
  if (!q) return <>{t}</>;
  const low = t.toLowerCase();
  const ql = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let idx: number;
  let k = 0;
  while ((idx = low.indexOf(ql, i)) !== -1) {
    if (idx > i) out.push(<Fragment key={k++}>{t.slice(i, idx)}</Fragment>);
    out.push(
      <mark key={k++} className="sr-hit">
        {t.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  out.push(<Fragment key={k++}>{t.slice(i)}</Fragment>);
  return <>{out}</>;
}
