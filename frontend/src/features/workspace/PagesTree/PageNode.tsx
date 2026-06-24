import type { CSSProperties } from 'react';
import {
  ChevronRightOutlined,
  DotsHorizontalOutlined,
  PageFoldPortraitOutlined,
} from '@toddle-edu/ds-icons';
import { IconButton } from '@toddle-edu/ds-web';
import { ActionMenu } from '../../../components/ActionMenu';
import { useUiStore } from '../../../stores/uiStore';
import { cn } from '../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';
import type { TreeDoc } from '../pagesModel';
import { buildPageMenuItems } from './pageMenuItems';
import { NewPageRow } from './NewPageRow';
import type { DocTreeController } from './useDocTree';

// ICON_OFFSET = chevron button (~20) + gap (10), so a "New page" row's + lines up
// with the page-icon column of the children above it.
const BASE_INDENT = 8;
const INDENT_STEP = 15;
const NEW_PAGE_ICON_OFFSET = 30;

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
      openModal({
        type: 'renamePage',
        kind: 'doc',
        workspaceId: tree.ws,
        id: doc.id,
        name: doc.title,
      }),
    onDelete: () =>
      openModal({
        type: 'confirmDeletePage',
        kind: 'doc',
        workspaceId: tree.ws,
        id: doc.id,
        name: doc.title,
      }),
  });

  const rowClassName = cn(
    'group',
    sidebarRow.base,
    selDoc === doc.id ? sidebarRow.selected : sidebarRow.default,
  );
  const rowStyle: CSSProperties = { paddingLeft: BASE_INDENT + depth * INDENT_STEP };
  // Leaf pages keep the (hidden) chevron so icons stay aligned.
  const chevronButtonClassName = cn('shrink-0', !hasKids && 'invisible');
  const chevronIconClassName = cn('transition-transform', open && 'rotate-90');

  return (
    <>
      <div
        className={rowClassName}
        style={rowStyle}
        role="button"
        onClick={() => selectDoc(doc.id)}
      >
        <IconButton
          dsVersion="2.0"
          type="plain"
          variant="neutral"
          size="x-small"
          isCompact
          shouldStopPropagation
          className={chevronButtonClassName}
          aria-label={open ? 'Collapse page' : 'Expand page'}
          onClick={() => toggle(doc.id)}
          icon={<ChevronRightOutlined variant="subtle" className={chevronIconClassName} />}
        />

        <PageFoldPortraitOutlined variant="subtle" size="xxx-small" />

        <span className="flex-1 truncate">{doc.title}</span>

        {menuItems.length > 0 && (
          <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
            <ActionMenu
              placement="bottomRight"
              trigger={
                <IconButton
                  dsVersion="2.0"
                  type="plain"
                  variant="neutral"
                  size="x-small"
                  isCompact
                  className="hidden group-hover:flex"
                  aria-label="Page actions"
                  icon={<DotsHorizontalOutlined variant="subtle" />}
                />
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
