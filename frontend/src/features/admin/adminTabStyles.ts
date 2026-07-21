// Shared Tailwind class map for the admin console tab surfaces. The page frame
// and header block are identical across tabs, so they live here rather than being
// re-copied into each tab (mirrors components/tableStyles.ts for the data tables).
export const adminTabStyles = {
  // Full-height scroll frame; flex column so a table child can grow to fill it.
  page: 'flex flex-1 flex-col overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto flex w-full max-w-[1040px] flex-1 flex-col',
  pageHead: 'mb-5 flex items-end justify-between gap-[18px]',
  h1: 'm-0 text-[25px] font-extrabold tracking-[-0.01em]',
  headSub: 'mt-1 text-[13px] text-secondary',
} as const;
