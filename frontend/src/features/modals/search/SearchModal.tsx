import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@toddle-edu/ds-web';
import { Modal } from '../../../components/Modal';
import { useDocSearch } from '../../../hooks/useDocSearch';
import { usePreviewToggle } from '../../../hooks/usePreviewToggle';
import { useDocuments } from '../../../hooks/usePages';
import { useVirtualRows } from '../../../hooks/useVirtualRows';
import type { SearchResultDto } from '../../../types/api';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { SearchField } from './SearchField';
import { ResultRow, SEARCH_ROW_HEIGHT } from './ResultRow';
import { SearchEmpty } from './SearchEmpty';
import { PreviewPane } from './PreviewPane';

const styles = {
  // --gs-chrome = 60px field + 1px border + 2.5rem footer (py-2.5 + h-5 hints) — rem-aware so browser font scaling can't break the caps.
  search: 'flex flex-col w-full rounded-3 overflow-hidden [--gs-chrome:calc(61px+2.5rem)]',
  grow: 'flex-none overflow-hidden motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out',
  // Body caps = panel caps (74vh spotlight / 624px+84vh split) minus the chrome var.
  growSpot: 'flex flex-col max-h-[calc(74vh-var(--gs-chrome))]',
  growSplit: 'flex flex-col h-[calc(624px-var(--gs-chrome))] max-h-[calc(84vh-var(--gs-chrome))]',
  splitBody: 'flex-1 flex min-h-0',
  splitList: 'w-[414px] flex-none flex flex-col min-h-0 border-r border-solid border-secondary',
  listPane: 'relative flex-1 min-h-0 flex flex-col',
  list: 'flex-1 overflow-auto p-2',
  none: 'py-10 px-4 text-center text-size-100 text-secondary',
  loadmore: 'absolute bottom-3 left-1/2 -translate-x-1/2 z-[2]',
  foot: 'flex items-center gap-4 flex-none py-2.5 px-4 border-t border-solid border-secondary bg-surface-secondary-enabled',
  hint: 'inline-flex items-center gap-1.5 text-size-50 text-secondary',
  gap: 'flex-1',
  error: 'flex-1 flex flex-col items-center justify-center gap-3 py-10 px-6 text-center',
  errorMsg: 'text-size-100 text-secondary',
  errorRetry:
    'h-[34px] px-4 rounded-2 border border-solid border-primary bg-[var(--panel-bg)] text-primary text-size-75 font-weight-600 cursor-pointer hover:border-[var(--border-focus)]',
};

// Distinguish an offline/transport failure from a server error so the message is accurate.
function searchErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/network|failed to fetch|load failed|connection|fetch/i.test(msg)) {
    return 'Network error — check your connection and try again.';
  }
  return 'Something went wrong while searching. Please try again.';
}

// Animates the body to its measured content height; inner renders at final size, the wrapper clips during the tween.
function AnimatedHeight({
  children,
  innerClassName,
}: {
  children: React.ReactNode;
  innerClassName: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={styles.grow} style={{ height: height ?? 'auto' }}>
      <div ref={innerRef} className={innerClassName}>
        {children}
      </div>
    </div>
  );
}

export function SearchModal({
  onClose,
  workspaceId,
}: {
  onClose: () => void;
  workspaceId?: string;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);

  const {
    results,
    totals,
    isSearching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    hasResponse,
  } = useDocSearch(q, workspaceId);

  // Layout resolution — the single source of truth.
  const isGlobal = workspaceId === undefined;
  const [previewOn, setPreviewOn] = usePreviewToggle();
  // The search runs on the trimmed query (useDocSearch trims before fetching), so
  // highlighting must too — raw " page" would never match inside returned titles.
  const qTrimmed = q.trim();
  const hasQuery = qTrimmed.length > 0;
  const showToggle = !isGlobal;
  // Collapse the split (and its preview "Open doc" affordance) when there's nothing to
  // preview — no results means the narrow single-column no-results message, not a wide shell.
  const showPreview = !isGlobal && previewOn && hasQuery && results.length > 0;
  const wide = showPreview; // 1000px vs 640px
  const { data: wsDocs = [] } = useDocuments(workspaceId);

  // Reset selection on a NEW query — not when more pages append (that must not jump).
  useEffect(() => {
    setSelectedIndex(0);
  }, [q]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
  const selected: SearchResultDto | undefined = results[activeIndex];

  // Virtualize the result list — fixed-height rows, so windowing is pure arithmetic.
  const virtual = useVirtualRows(listEl, results.length, SEARCH_ROW_HEIGHT);
  // Read scrollToIndex through a ref so identity changes (e.g. pages appending) don't
  // re-run the effect and yank the scroll back to the active row.
  const scrollToIndexRef = useRef(virtual.scrollToIndex);
  scrollToIndexRef.current = virtual.scrollToIndex;

  // Re-run on selection change AND on list remount (listEl identity), so toggles re-scroll the fresh element.
  useEffect(() => {
    scrollToIndexRef.current(activeIndex);
  }, [activeIndex, listEl]);

  const openDoc = (r: SearchResultDto) => {
    navigate(`/w/${r.workspaceId}?doc=${r.id}`);
    onClose();
  };

  // Click: in the split layout a click SELECTS (updates the preview); elsewhere it opens directly.
  const onRowClick = (r: SearchResultDto, i: number) => {
    if (showPreview) setSelectedIndex(i);
    else openDoc(r);
  };

  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  // Auto-load the next page as the list nears its end, so the "Load more" pill never obstructs.
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) loadMore();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (Math.min(i, results.length - 1) + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (Math.min(i, results.length - 1) - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex];
      if (!r) return;
      if (e.metaKey || e.ctrlKey) window.open(`/w/${r.workspaceId}?doc=${r.id}`, '_blank');
      else openDoc(r);
    }
  };

  // Only the windowed rows are mounted; each is absolutely positioned at its measured offset.
  const rows = (
    <div style={{ position: 'relative', height: virtual.totalHeight }}>
      {virtual.items.map(({ index, start }) => {
        const r = results[index];
        if (!r) return null;
        return (
          <div key={r.id} style={{ position: 'absolute', top: start, left: 0, right: 0 }}>
            <ResultRow
              doc={r}
              q={qTrimmed}
              active={index === activeIndex}
              isGlobal={isGlobal}
              wsDocs={wsDocs}
              onClick={() => onRowClick(r, index)}
            />
          </div>
        );
      })}
    </div>
  );

  // Load-more floats over the bottom of the list (list scrolls behind it), showing either the
  // manual pill or a loading/retry state — no in-flow row that eats list height.
  const loadMorePill =
    results.length > 0 && (hasNextPage || isError) ? (
      <div className={styles.loadmore}>
        <Button
          dsVersion="2.0"
          variant="neutral"
          type="outlined"
          size="small"
          isLoading={isFetchingNextPage}
          onClick={loadMore}
        >
          {isError ? 'Couldn’t load more — retry' : `Load more · ${results.length} / ${totals.total}`}
        </Button>
      </div>
    ) : null;

  const list = (
    <div className={styles.listPane}>
      <div className={styles.list} ref={setListEl} onScroll={onListScroll}>
        {results.length > 0 ? (
          rows
        ) : isSearching ? (
          <div className={styles.none}>Searching…</div>
        ) : (
          <div className={styles.none}>No documents match “{qTrimmed}”.</div>
        )}
      </div>
      {loadMorePill}
    </div>
  );

  const errorState = (
    <div className={styles.error}>
      <div className={styles.errorMsg}>{searchErrorText(error)}</div>
      <button type="button" className={styles.errorRetry} onClick={() => void refetch()}>
        Try again
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (!hasQuery) {
    body = <SearchEmpty />;
  } else if (isError && results.length === 0) {
    body = errorState;
  } else if (!hasResponse) {
    // Hold the prompt during the first fetch so the panel expands once, not shrink→grow.
    body = <SearchEmpty />;
  } else if (showPreview) {
    body = (
      <div className={styles.splitBody}>
        <div className={styles.splitList}>
          {list}
        </div>
        <PreviewPane docId={selected?.id} onOpen={() => selected && openDoc(selected)} />
      </div>
    );
  } else {
    body = (
      <>
        {list}
      </>
    );
  }

  return (
    <Modal onClose={onClose} width={wide ? '1000px' : '640px'} className="gs-search-modal">
      <div
        className={styles.search}
        data-testid="gs-search"
        data-layout={wide ? 'split' : 'spotlight'}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Search documents"
      >
        <SearchField
          value={q}
          onChange={setQ}
          showToggle={showToggle}
          previewOn={previewOn}
          setPreviewOn={setPreviewOn}
          isSearching={isSearching}
        />

        <AnimatedHeight innerClassName={wide ? styles.growSplit : styles.growSpot}>{body}</AnimatedHeight>

        <div className={styles.foot}>
          <span className={styles.hint}>
            <ShortcutHint keys={['↑', '↓']} /> Navigate
          </span>
          <span className={styles.hint}>
            <ShortcutHint keys={['↵']} /> Open
          </span>
          <span className={styles.hint}>
            <ShortcutHint keys={['⌘', '↵']} /> Open in new tab
          </span>
          <span className={styles.hint}>
            <ShortcutHint keys={['Esc']} /> Close
          </span>
          <span className={styles.gap} />
          {hasQuery && (
            <span className={styles.hint} data-testid="gs-count">
              {hasResponse ? `${results.length} / ${totals.total} shown` : 'Searching…'}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
