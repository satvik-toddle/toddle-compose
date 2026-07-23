import { Fragment, type ReactNode } from 'react';

// Amber term highlight — the --search-hit-* vars are theme-defined in search.css (not DS tokens).
const styles = {
  hit: 'rounded-[3px] px-px font-weight-700 bg-[var(--search-hit-bg)] text-[var(--search-hit-fg)]',
};

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
      <mark key={k++} className={styles.hit} data-testid="sr-hit">
        {t.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  out.push(<Fragment key={k++}>{t.slice(i)}</Fragment>);
  return <>{out}</>;
}
