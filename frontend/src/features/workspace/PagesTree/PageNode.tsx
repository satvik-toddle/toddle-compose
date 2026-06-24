import type { CSSProperties, KeyboardEvent } from 'react';
import {
  ChevronRightOutlined,
  DotsHorizontalOutlined,
  PageFoldPortraitOutlined,
} from '@toddle-edu/ds-icons';
import { Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import { useUiStore } from '../../../stores/uiStore';
import { cn } from '../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';
import type { TreeDoc } from '../pagesModel';
import { buildPageMenuItems, type PageMenuOption } from './pageMenuItems';
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

  const styles = {
    row: cn('group', sidebarRow.base, selDoc === doc.id ? sidebarRow.selected : sidebarRow.default),
    // Leaf pages keep the (hidden) chevron so icons stay aligned.
    chevronButton: cn('shrink-0', !hasKids && 'invisible'),
    chevronIcon: cn('transition-transform', open && 'rotate-90'),
    label: 'flex-1 truncate',
    menuWrap: 'flex shrink-0',
    menuTrigger: 'hidden group-hover:flex',
    rowStyle: { paddingLeft: BASE_INDENT + depth * INDENT_STEP } as CSSProperties,
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isActivationKey = e.key === 'Enter' || e.key === ' ';
    if (!isActivationKey) return;
    e.preventDefault();
    selectDoc(doc.id);
  };

  return (
    <>
      <div
        className={styles.row}
        style={styles.rowStyle}
        role="button"
        tabIndex={0}
        onClick={() => selectDoc(doc.id)}
        onKeyDown={handleRowKeyDown}
      >
        <IconButton
          dsVersion="2.0"
          type="plain"
          variant="neutral"
          size="x-small"
          isCompact
          shouldStopPropagation
          className={styles.chevronButton}
          aria-label={open ? 'Collapse page' : 'Expand page'}
          onClick={() => toggle(doc.id)}
          icon={<ChevronRightOutlined variant="subtle" className={styles.chevronIcon} />}
        />

        <PageFoldPortraitOutlined variant="subtle" size="xxx-small" />
        <span className={styles.label}>{doc.title}</span>

        {menuItems.length > 0 && (
          <span className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
            <Dropdown
              placement="bottomRight"
              overlay={
                <DropdownMenu
                  dsVersion="2.0"
                  options={menuItems}
                  onClick={(opt: PageMenuOption) =>
                    menuItems.find((m) => m.key === opt.key)?.onSelect?.()
                  }
                />
              }
            >
              {/* antd attaches its ref/onClick to the trigger's DOM node — wrap the
                  ds-web IconButton in a span so it doesn't warn about refs. */}
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  dsVersion="2.0"
                  type="plain"
                  variant="neutral"
                  size="x-small"
                  isCompact
                  className={styles.menuTrigger}
                  aria-label="Page actions"
                  icon={<DotsHorizontalOutlined variant="subtle" />}
                />
              </span>
            </Dropdown>
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
