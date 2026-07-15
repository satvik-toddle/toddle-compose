import { SearchOutlined } from '@toddle-edu/ds-icons';

const styles = {
  empty: 'flex-1 flex flex-col items-center justify-center gap-3.5 pt-16 px-6 pb-18 text-center',
  glyph: 'w-[34px] h-[34px] text-placeholder opacity-70',
  prompt: 'text-size-200 font-weight-600 text-secondary',
  tips: 'flex flex-wrap justify-center gap-2',
  tip: 'text-size-50 text-secondary bg-surface-secondary-enabled border border-solid border-secondary rounded-[7px] px-[9px] py-[5px]',
};

// Pre-typing minimal prompt (both scopes). No recents, no data fetching.
export function SearchEmpty() {
  return (
    <div className={styles.empty} data-testid="gs-empty">
      <SearchOutlined className={styles.glyph} aria-hidden />
      <div className={styles.prompt}>Search docs by title or content</div>
      <div className={styles.tips}>
        <span className={styles.tip}>Titles &amp; content both searched</span>
        <span className={styles.tip}>Only docs you can access appear</span>
      </div>
    </div>
  );
}
