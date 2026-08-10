import { useEffect, useRef, useState, type RefObject } from 'react';
import { InformationOutlined } from '@toddle-edu/ds-icons';
import { Loader } from '../../../../components/Loader';
import { PageRow } from './PageRow';
import type { PagesSectionController } from './usePagesSection';

// Fixed row pitch (row is 32px + the 1px inter-row gap) — the list is virtualized on it.
const ROW_H = 33;
// Extra rows rendered above/below the viewport so fast scrolls don't flash blank.
const OVERSCAN = 8;
// Bound the "keep loading until the list fills the viewport" behavior so a mostly-collapsed
// tree (few visible rows, never overflows) can't eagerly fetch the entire workspace.
const MAX_AUTO_FILL_PAGES = 10;

const styles = {
  statusMessage: 'flex items-center gap-2 px-2.25 py-2 text-body-s text-secondary',
  loader: 'flex flex-1 items-center justify-center',
  loadingMore: 'flex items-center justify-center py-2',
};

// Icon + message row shared by the empty and no-results states.
function StatusMessage({ message }: Readonly<{ message: string }>) {
  return (
    <div className={styles.statusMessage}>
      <InformationOutlined variant="subtle" size="xxx-small" />
      {message}
    </div>
  );
}

// Scrollable page hierarchy; the "Pages" heading + "New page" live in WorkspaceSidebar.
// Virtualized: only the rows in (and near) the viewport are mounted, so selecting/expanding
// and scrolling stay O(visible) even with tens of thousands of docs paged in.
export function PagesSection({
  pages,
  scrollRef,
}: Readonly<{ pages: PagesSectionController; scrollRef: RefObject<HTMLElement | null> }>) {
  const { isLoading, isEmpty, flattened, isLoadingMore, hasMore, loadMore } = pages;
  const count = flattened.length;

  // Visible window [start, end) computed from the scroll container's scrollTop/height.
  const [range, setRange] = useState({ start: 0, end: 0 });
  const autoFills = useRef(0);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const recompute = () => {
      const start = Math.max(0, Math.floor(sc.scrollTop / ROW_H) - OVERSCAN);
      const visible = Math.ceil(sc.clientHeight / ROW_H) + OVERSCAN * 2;
      setRange({ start, end: Math.min(count, start + visible) });
      // Lazy-load: pull the next docs page as the bottom nears.
      if (hasMore && sc.scrollHeight - sc.scrollTop - sc.clientHeight < ROW_H * OVERSCAN) {
        loadMore();
      }
      // Fill the viewport when the content doesn't overflow (few/collapsed rows), bounded so
      // it can't walk the whole workspace.
      if (hasMore && count * ROW_H <= sc.clientHeight && autoFills.current < MAX_AUTO_FILL_PAGES) {
        autoFills.current += 1;
        loadMore();
      }
    };
    recompute();
    sc.addEventListener('scroll', recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', recompute);
      ro.disconnect();
    };
    // count changes when pages load / nodes expand → recompute the window and re-check fill.
  }, [scrollRef, count, hasMore, loadMore]);

  if (isLoading) {
    return (
      <div className={styles.loader}>
        <Loader size={28} />
      </div>
    );
  }
  if (isEmpty) return <StatusMessage message="No pages yet" />;

  const slice = flattened.slice(range.start, range.end);
  return (
    // Spacer of the full list height; each visible row is absolutely positioned at its offset.
    <div style={{ position: 'relative', height: count * ROW_H }}>
      {slice.map((row, i) => {
        const index = range.start + i;
        return (
          <div
            key={row.node.doc.id}
            style={{ position: 'absolute', top: index * ROW_H, left: 0, right: 0, height: ROW_H }}
          >
            <PageRow
              node={row.node}
              depth={row.depth}
              pages={pages}
              isSelected={pages.selectedPageId === row.node.doc.id}
              isExpanded={pages.expanded.has(row.node.doc.id)}
            />
          </div>
        );
      })}
      {isLoadingMore && (
        <div className={styles.loadingMore} style={{ position: 'absolute', top: count * ROW_H, left: 0, right: 0 }}>
          <Loader size={20} />
        </div>
      )}
    </div>
  );
}
