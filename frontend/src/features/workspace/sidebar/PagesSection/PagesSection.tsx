import { useEffect, useRef } from 'react';
import { InformationOutlined } from '@toddle-edu/ds-icons';
import { Loader } from '../../../../components/Loader';
import { PageRow } from './PageRow';
import type { PagesSectionController } from './usePagesSection';

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
export function PagesSection({ pages }: Readonly<{ pages: PagesSectionController }>) {
  const { isLoading, isEmpty, roots, isLoadingMore, hasMore, loadMore } = pages;

  // Lazy-load like search: fetch the next docs page as the sidebar nears its scroll bottom.
  // The scroll container is an ancestor (WorkspaceSidebar's body), located from the list element.
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let sc: HTMLElement | null = listRef.current?.parentElement ?? null;
    while (sc && getComputedStyle(sc).overflowY !== 'auto') sc = sc.parentElement;
    scrollerRef.current = sc;
    if (!sc) return;
    const onScroll = () => {
      if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) loadMore();
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, [loadMore]);

  // Keep pulling pages until the list overflows: with few/collapsed rows the container never
  // scrolls, so the scroll listener alone would never fire and later pages would never load.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || !hasMore || isLoadingMore) return;
    if (sc.scrollHeight <= sc.clientHeight) loadMore();
  }, [roots, hasMore, isLoadingMore, loadMore]);

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
    <div ref={listRef} className={styles.pageList}>
      {renderPages()}
      {isLoadingMore && (
        <div className={styles.loadingMore}>
          <Loader size={20} />
        </div>
      )}
    </div>
  );
}
