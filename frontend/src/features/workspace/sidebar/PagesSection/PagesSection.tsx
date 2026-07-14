import { InformationOutlined } from '@toddle-edu/ds-icons';
import { Loader } from '../../../../components/Loader';
import { PageRow } from './PageRow';
import type { PagesSectionController } from './usePagesSection';

const styles = {
  pageList: 'flex h-full flex-col gap-px',
  statusMessage: 'flex items-center gap-2 px-2.25 py-2 text-body-s text-secondary',
  loader: 'flex flex-1 items-center justify-center',
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
  const { isLoading, isEmpty, roots } = pages;

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

  return <div className={styles.pageList}>{renderPages()}</div>;
}
