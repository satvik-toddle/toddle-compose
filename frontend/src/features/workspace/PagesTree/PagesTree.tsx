import { InformationOutlined } from '@toddle-edu/ds-icons';
import type { WorkspaceCtx } from '../WorkspaceLayout';
import { useDocTree } from './useDocTree';
import { PageNode } from './PageNode';
import { NewPageRow } from './NewPageRow';

// Indent for the root-level "New page" row: base (8) + chevron button (~20) + gap
// (10), so its + aligns with the page-icon column of the root rows.
const ROOT_NEW_PAGE_INDENT = 38;

const styles = {
  sectionHeading: 'flex items-center px-2.25 pt-4 pb-1.5 text-label-xs uppercase text-secondary',
  pageTreeContainer: 'flex flex-col gap-px',
  statusMessage: 'flex items-center gap-1.75 px-2.25 py-2 text-body-s text-secondary',
};

// Coda-style page tree: every row is a page (document); a page that has child
// pages can expand. Nesting is by document parentId — no separate folder type.
export function PagesTree({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const tree = useDocTree(ctx);
  const { isLoading, isEmpty, roots, canCreate } = tree;

  const renderTreeContent = () => {
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
          <PageNode key={node.doc.id} node={node} depth={0} tree={tree} />
        ))}

        {canCreate && (
          <NewPageRow indent={ROOT_NEW_PAGE_INDENT} onClick={() => tree.createPage()} />
        )}
      </>
    );
  };

  return (
    <>
      <div className={styles.sectionHeading}>Pages</div>
      <div className={styles.pageTreeContainer}>{renderTreeContent()}</div>
    </>
  );
}
