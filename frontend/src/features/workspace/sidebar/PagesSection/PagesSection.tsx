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
  const { isLoading, isEmpty, roots, isLoadingMore } = pages;

  // Lazy-load like search: fetch the next docs page as the sidebar scrolls near its
  // bottom (same near-bottom listener as SearchModal). The scroll container is an
  // ancestor (WorkspaceSidebar's body), so it's located from the list element; loadMore
  // is read through a ref so the listener is attached exactly once.
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(pages.loadMore);
  loadMoreRef.current = pages.loadMore;
  useEffect(() => {
    let sc: HTMLElement | null = listRef.current?.parentElement ?? null;
    while (sc && getComputedStyle(sc).overflowY !== 'auto') sc = sc.parentElement;
    if (!sc) return;
    const scroller = sc;
    const onScroll = () => {
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 200) {
        loadMoreRef.current();
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

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
