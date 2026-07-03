// Shared Tailwind class map for the DS-style data tables — replaces the old
// global rbac.css primitives (.tbl/.thead/.trow/.cell-main/.nm/.sub/.you-tag).
export const tableStyles = {
  table: 'overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--panel-bg)]',
  thead: 'grid items-center border-b border-[var(--line)] bg-surface-secondary-enabled',
  th: 'px-4 py-[11px] text-[11px] font-bold uppercase tracking-[0.04em] text-secondary',
  trow: 'grid items-center border-b border-[var(--line)] last:border-b-0 hover:bg-surface-secondary-enabled',
  td: 'px-4 py-[13px] text-[13px]',
  tdMuted: 'px-4 py-[13px] text-[12px] text-secondary',
  tdActions: 'flex justify-end gap-[7px] px-4 py-[13px]',
  cellRight: 'text-right',
  nm: 'text-[13px] font-semibold',
  rowSub: 'mt-px text-[12px] text-secondary',
  youTag:
    'ml-1.5 rounded-[5px] bg-[var(--surface-primary-selected)] px-1.5 py-px align-middle text-[10px] font-bold text-[var(--blue-400)]',
} as const;
