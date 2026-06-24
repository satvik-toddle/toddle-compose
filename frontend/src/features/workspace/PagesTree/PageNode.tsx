import { Icon } from '../../../components/Icon';
import { ActionMenu } from '../../../components/ActionMenu';
import { useUiStore } from '../../../stores/uiStore';
import { cn } from '../../../lib/cn';
import type { TreeDoc } from '../pagesModel';
import { buildPageMenuItems } from './pageMenuItems';
import { NewPageRow } from './NewPageRow';
import type { DocTreeController } from './useDocTree';
import s from './PagesTree.module.scss';

// Row layout constants (px). ICON_OFFSET = chevron (14) + gap (7), so a "New page"
// row's + lines up with the page-icon column of the children above it.
const BASE_INDENT = 8;
const INDENT_STEP = 15;
const NEW_PAGE_ICON_OFFSET = 21;

// A single page row, rendered recursively: an expandable parent renders its
// children (and a trailing "New page" row) when open.
export function PageNode({
  node,
  depth,
  tree,
}: Readonly<{ node: TreeDoc; depth: number; tree: DocTreeController }>) {
  const { expanded, selDoc, canCreate, canManage, toggle, selectDoc, createPage } = tree;
  const openModal = useUiStore((st) => st.openModal);
  const { doc, children } = node;
  const hasKids = children.length > 0;
  const open = expanded.has(doc.id);

  const menuItems = buildPageMenuItems({
    canCreate,
    canManage: canManage(doc.owner.id),
    onAddSubpage: () => createPage(doc.id),
    onRename: () =>
      openModal({ type: 'renamePage', kind: 'doc', workspaceId: tree.ws, id: doc.id, name: doc.title }),
    onDelete: () =>
      openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId: tree.ws, id: doc.id, name: doc.title }),
  });

  return (
    <>
      <div
        className={cn(s.treeRow, s.doc, selDoc === doc.id && s.active)}
        style={{ paddingLeft: BASE_INDENT + depth * INDENT_STEP }}
        role="button"
        onClick={() => selectDoc(doc.id)}
      >
        <span
          className="chev-wrap"
          // Keep the chevron column for leaf pages too, so icons stay aligned.
          style={{ display: 'inline-flex', visibility: hasKids ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            toggle(doc.id);
          }}
        >
          <Icon name="ChevronRightOutlined" size={14} muted className={cn(s.chev, open && s.open)} />
        </span>
        <span className="tw-emoji">
          <Icon name="FileOutlined" size={16} muted />
        </span>
        <span className={s.twLbl}>{doc.title}</span>
        {menuItems.length > 0 && (
          <span className="tw-more-wrap" onClick={(e) => e.stopPropagation()}>
            <ActionMenu
              placement="bottomRight"
              trigger={
                <button className={s.twMore}>
                  <Icon name="DotsHorizontalOutlined" size={14} muted />
                </button>
              }
              items={menuItems}
            />
          </span>
        )}
      </div>
      {open && hasKids && (
        <>
          {children.map((c) => (
            <PageNode key={c.doc.id} node={c} depth={depth + 1} tree={tree} />
          ))}
          {canCreate && (
            <NewPageRow
              indent={BASE_INDENT + (depth + 1) * INDENT_STEP + NEW_PAGE_ICON_OFFSET}
              onClick={() => createPage(doc.id)}
            />
          )}
        </>
      )}
    </>
  );
}
