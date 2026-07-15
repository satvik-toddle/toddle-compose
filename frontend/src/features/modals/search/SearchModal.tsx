import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SpinnerLoader } from '@toddle-edu/ds-web';
import { Modal } from '../../../components/Modal';
import { useDocSearch } from '../../../hooks/useDocSearch';
import { usePreviewToggle } from '../../../hooks/usePreviewToggle';
import { useDocuments } from '../../../hooks/usePages';
import { useVirtualRows } from '../../../hooks/useVirtualRows';
import type { SearchResultDto } from '../../../types/api';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { SearchField } from './SearchField';
import { ResultRow } from './ResultRow';
import { SearchEmpty } from './SearchEmpty';
import { PreviewPane } from './PreviewPane';

// Distinguish an offline/transport failure from a server error so the message is accurate.
function searchErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/network|failed to fetch|load failed|connection|fetch/i.test(msg)) {
    return 'Network error — check your connection and try again.';
  }
  return 'Something went wrong while searching. Please try again.';
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
  const listRef = useRef<HTMLDivElement>(null);

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

  // Virtualize the result list (rows vary in height — title ± snippet ± path). ~64px is the
  // common title+snippet row; the hook measures real heights and re-lays out.
  const virtual = useVirtualRows(listRef, results.length, 64);
  // Read scrollToIndex through a ref so re-layouts (which change its identity on every
  // measurement) don't re-run the effect and yank the scroll back to the active row.
  const scrollToIndexRef = useRef(virtual.scrollToIndex);
  scrollToIndexRef.current = virtual.scrollToIndex;

  // Only scroll to the active row on an actual selection/layout change (keyboard nav), never
  // on measurement-driven re-renders.
  useEffect(() => {
    scrollToIndexRef.current(activeIndex);
  }, [activeIndex, showPreview]);

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
      {virtual.items.map(({ index, start, measureRef }) => {
        const r = results[index];
        if (!r) return null;
        return (
          <div key={r.id} ref={measureRef} style={{ position: 'absolute', top: start, left: 0, right: 0 }}>
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

  // Loaded-so-far vs total matches, so the count is never mistaken for "all there is".
  const count = (
    <div className="gs-count">
      {results.length} / {totals.total} shown
    </div>
  );

  // Load-more floats over the bottom of the list (list scrolls behind it), showing either the
  // manual pill or a loading/retry state — no in-flow row that eats list height.
  const loadMorePill =
    results.length > 0 && (hasNextPage || isError) ? (
      <button
        type="button"
        className="gs-loadmore"
        onClick={loadMore}
        disabled={isFetchingNextPage}
      >
        {isFetchingNextPage ? (
          <>
            <SpinnerLoader size="small" /> Loading…
          </>
        ) : isError ? (
          'Couldn’t load more — retry'
        ) : (
          `Load more · ${results.length} / ${totals.total}`
        )}
      </button>
    ) : null;

  const list = (
    <div className="gs-list-pane">
      <div className="gs-list" ref={listRef} onScroll={onListScroll}>
        {results.length > 0 ? (
          rows
        ) : isSearching ? (
          <div className="gs-none">Searching…</div>
        ) : (
          <div className="gs-none">No documents match “{qTrimmed}”.</div>
        )}
      </div>
      {loadMorePill}
    </div>
  );

  const errorState = (
    <div className="gs-error">
      <div className="gs-error-msg">{searchErrorText(error)}</div>
      <button type="button" className="gs-error-retry" onClick={() => void refetch()}>
        Try again
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (!hasQuery) {
    body = <SearchEmpty />;
  } else if (isError && results.length === 0) {
    body = errorState;
  } else if (showPreview) {
    body = (
      <div className="gs-split-body">
        <div className="gs-split-list">
          {count}
          {list}
        </div>
        <PreviewPane docId={selected?.id} onOpen={() => selected && openDoc(selected)} />
      </div>
    );
  } else {
    body = (
      <>
        {count}
        {list}
      </>
    );
  }

  return (
    <Modal onClose={onClose} width={wide ? '1000px' : '640px'} className="gs-search-modal">
      <div
        className={`gs-search ${wide ? 'gs-split' : 'gs-sp'}`}
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
        />

        {body}

        <div className="gs-foot">
          <span className="hint">
            <ShortcutHint keys={['↑', '↓']} /> Navigate
          </span>
          <span className="hint">
            <ShortcutHint keys={['↵']} /> Open
          </span>
          <span className="hint">
            <ShortcutHint keys={['⌘', '↵']} /> Open in new tab
          </span>
          <span className="gap" />
          <span className="hint">
            {isGlobal ? 'Searching all workspaces you can access' : 'Searching this workspace'}
          </span>
        </div>
      </div>
    </Modal>
  );
}
