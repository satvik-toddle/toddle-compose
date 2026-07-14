import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SpinnerLoader } from '@toddle-edu/ds-web';
import { Modal } from '../../../components/Modal';
import { useDocSearch } from '../../../hooks/useDocSearch';
import { usePreviewToggle } from '../../../hooks/usePreviewToggle';
import { useDocuments } from '../../../hooks/usePages';
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

  // Layout resolution — the single source of truth.
  const isGlobal = workspaceId === undefined;
  const [previewOn, setPreviewOn] = usePreviewToggle();
  const hasQuery = q.trim().length > 0;
  const showToggle = !isGlobal;
  const showPreview = !isGlobal && previewOn && hasQuery;
  const wide = showPreview; // 1000px vs 640px

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
  const { data: wsDocs = [] } = useDocuments(workspaceId);

  // Reset selection on a NEW query — not when more pages append (that must not jump).
  useEffect(() => {
    setSelectedIndex(0);
  }, [q]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
  const selected: SearchResultDto | undefined = results[activeIndex];

  useEffect(() => {
    listRef.current?.querySelector('.sr.on')?.scrollIntoView({ block: 'nearest' });
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

  const rows = results.map((r, i) => (
    <ResultRow
      key={r.id}
      doc={r}
      q={q}
      active={i === activeIndex}
      isGlobal={isGlobal}
      wsDocs={wsDocs}
      onClick={() => onRowClick(r, i)}
    />
  ));

  // Loaded-so-far vs total matches, so the count is never mistaken for "all there is".
  const count = (
    <div className="gs-count">
      {results.length} / {totals.total} shown
    </div>
  );

  const list = (
    <div className="gs-list" ref={listRef} onScroll={onListScroll}>
      {results.length > 0 ? (
        <>
          {rows}
          {isFetchingNextPage && (
            <div className="gs-loading">
              <SpinnerLoader size="small" /> Loading more…
            </div>
          )}
          {isError && (
            <button type="button" className="gs-inline-retry" onClick={loadMore}>
              Couldn’t load more — retry
            </button>
          )}
        </>
      ) : isSearching ? (
        <div className="gs-none">Searching…</div>
      ) : (
        <div className="gs-none">No documents match “{q.trim()}”.</div>
      )}
    </div>
  );

  const loadMorePill =
    hasNextPage && !isFetchingNextPage && results.length > 0 ? (
      <button type="button" className="gs-loadmore" onClick={loadMore}>
        Load more · {results.length} / {totals.total}
      </button>
    ) : null;

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
          {loadMorePill}
        </div>
        <PreviewPane docId={selected?.id} q={q} onOpen={() => selected && openDoc(selected)} />
      </div>
    );
  } else {
    body = (
      <>
        {count}
        {list}
        {loadMorePill}
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
