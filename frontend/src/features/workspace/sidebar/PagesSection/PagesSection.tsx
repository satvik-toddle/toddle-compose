import { InformationOutlined } from '@toddle-edu/ds-icons';
import { PageRow } from './PageRow';
import type { PagesSectionController } from './usePagesSection';

const styles = {
  pageList: 'flex flex-col gap-px',
  statusMessage: 'flex items-center gap-1.75 px-2.25 py-2 text-body-s text-secondary',
};

// Scrollable page hierarchy; the "Pages" heading + "New page" live in WorkspaceSidebar.
export function PagesSection({ pages }: Readonly<{ pages: PagesSectionController }>) {
  const { isLoading, isEmpty, roots } = pages;

  const renderPages = () => {
    if (isLoading) {
      return <div className={styles.statusMessage}>Loading…</div>;
    }

    if (isEmpty) {
      return (
        <div className={styles.statusMessage}>
          <InformationOutlined variant="subtle" size="xxx-small" />
          No pages yet
        </div>
      );
    }

    return roots.map((node) => <PageRow key={node.doc.id} node={node} depth={0} pages={pages} />);
  };

  return <div className={styles.pageList}>{renderPages()}</div>;
}
