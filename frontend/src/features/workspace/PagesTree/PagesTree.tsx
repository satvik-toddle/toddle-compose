import { Icon } from '../../../components/Icon';
import type { WorkspaceCtx } from '../WorkspaceLayout';
import { useDocTree } from './useDocTree';
import { PageNode } from './PageNode';
import { NewPageRow } from './NewPageRow';
import s from './PagesTree.module.scss';

// Indent for the root-level "New page" row: base (8) + chevron button (~20) + gap
// (10), so its + aligns with the page-icon column of the root rows.
const ROOT_NEW_PAGE_INDENT = 38;

// Coda-style page tree: every row is a page (document); a page that has child
// pages can expand. Nesting is by document parentId — no separate folder type.
export function PagesTree({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const tree = useDocTree(ctx);
  const { isLoading, isEmpty, roots, canCreate } = tree;

  return (
    <>
      <div className={s.wsNavGrp}>Pages</div>
      <div className={s.wsTree}>
        {isLoading ? (
          <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
        ) : (
          <>
            {!isEmpty && roots.map((n) => <PageNode key={n.doc.id} node={n} depth={0} tree={tree} />)}
            {isEmpty && !canCreate && (
              <div
                style={{
                  padding: '10px 9px',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <Icon name="InformationOutlined" size={14} muted />
                No pages yet
              </div>
            )}
            {canCreate && <NewPageRow indent={ROOT_NEW_PAGE_INDENT} onClick={() => tree.createPage()} />}
          </>
        )}
      </div>
    </>
  );
}
