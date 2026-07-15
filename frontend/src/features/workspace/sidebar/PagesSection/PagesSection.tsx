import { useEffect, useRef, type RefObject } from 'react';
import { InformationOutlined } from '@toddle-edu/ds-icons';
import { Loader } from '../../../../components/Loader';
import { PageRow } from './PageRow';
import type { PagesSectionController } from './usePagesSection';

// Cap the "keep loading until the list overflows" behavior: with a mostly-collapsed tree the
// rendered rows never overflow, so without a bound this would eagerly fetch the whole workspace.
const MAX_AUTO_FILL_PAGES = 10;

const styles = {
  pageList: 'flex h-full flex-col gap-px',
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
export function PagesSection({
  pages,
  scrollRef,
}: Readonly<{ pages: PagesSectionController; scrollRef: RefObject<HTMLElement | null> }>) {
  const { isLoading, isEmpty, roots, isLoadingMore, hasMore, loadMore } = pages;

  // Lazy-load like search: fetch the next docs page as the sidebar nears its scroll bottom.
  // The scroll container ref is supplied by WorkspaceSidebar (no DOM walking).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onScroll = () => {
      if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) loadMore();
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, [loadMore, scrollRef]);

  // Fill the initial viewport: with few/collapsed rows the container never scrolls, so the
  // scroll listener alone would never fire. Bounded (MAX_AUTO_FILL_PAGES) so a mostly-collapsed
  // tree can't eagerly pull the entire workspace.
  const autoFills = useRef(0);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !hasMore || isLoadingMore) return;
    if (sc.scrollHeight <= sc.clientHeight && autoFills.current < MAX_AUTO_FILL_PAGES) {
      autoFills.current += 1;
      loadMore();
    }
  }, [roots, hasMore, isLoadingMore, loadMore, scrollRef]);

  const renderPages = () => {
    if (isLoading) {
      return (
        <div className={styles.loader}>
          <Loader size={28} />
        </div>
      );
    }

    if (isEmpty) return <StatusMessage message="No pages yet" />;

    return roots.map((node) => <PageRow key={node.doc.id} node={node} depth={0} pages={pages} />);
  };

  return (
    <div className={styles.pageList}>
      {renderPages()}
      {isLoadingMore && (
        <div className={styles.loadingMore}>
          <Loader size={20} />
        </div>
      )}
    </div>
  );
}
