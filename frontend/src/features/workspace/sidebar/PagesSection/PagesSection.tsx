import { InformationOutlined } from '@toddle-edu/ds-icons';
import type { WorkspaceCtx } from '../../WorkspaceLayout';
import { usePagesSection } from './usePagesSection';
import { PageRow } from './PageRow';
import { NewPageRow } from './NewPageRow';

// Indent for the root-level "New page" row: base (8) + chevron button (~20) + gap
// (10), so its + aligns with the page-icon column of the root rows.
const ROOT_NEW_PAGE_INDENT = 38;

const styles = {
  pageList: 'flex flex-col gap-px',
  statusMessage: 'flex items-center gap-1.75 px-2.25 py-2 text-body-s text-secondary',
};

// Scrollable page hierarchy; the "Pages" heading is pinned in WorkspaceSidebar.
export function PagesSection({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const pages = usePagesSection(ctx);
  const { isLoading, isEmpty, roots, canCreate } = pages;

  const renderPages = () => {
    if (isLoading) {
      return <div className={styles.statusMessage}>Loading…</div>;
    }

    if (isEmpty && !canCreate) {
      return (
        <div className={styles.statusMessage}>
          <InformationOutlined variant="subtle" size="xxx-small" />
          No pages yet
        </div>
      );
    }

    return (
      <>
        {roots.map((node) => (
          <PageRow key={node.doc.id} node={node} depth={0} pages={pages} />
        ))}

        {canCreate && (
          <NewPageRow indent={ROOT_NEW_PAGE_INDENT} onClick={() => pages.createPage()} />
        )}
      </>
    );
  };

  return <div className={styles.pageList}>{renderPages()}</div>;
}
