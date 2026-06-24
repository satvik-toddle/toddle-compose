import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  ChevronRightOutlined,
  DotsHorizontalOutlined,
  PageFoldPortraitOutlined,
} from '@toddle-edu/ds-icons';
import { Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import { useUiStore } from '../../../../stores/uiStore';
import { cn } from '../../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';
import type { TreeDoc } from '../../pagesModel';
import { buildPageMenuItems, type PageMenuOption } from './pageMenuItems';
import type { PagesSectionController } from './usePagesSection';

const BASE_INDENT = 8;
const INDENT_STEP = 15;

export function PageRow({
  node,
  depth,
  pages,
}: Readonly<{ node: TreeDoc; depth: number; pages: PagesSectionController }>) {
  const { expanded, selectedPageId, canCreate, canManage, toggle, selectPage, createPage } = pages;
  const openModal = useUiStore((st) => st.openModal);
  const { doc, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(doc.id);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const menuItems = buildPageMenuItems({
    canCreate,
    canManage: canManage(doc.owner.id),
    onAddSubpage: () => createPage(doc.id),
    onRename: () =>
      openModal({
        type: 'renamePage',
        kind: 'doc',
        workspaceId: pages.ws,
        id: doc.id,
        name: doc.title,
      }),
    onDelete: () =>
      openModal({
        type: 'confirmDeletePage',
        kind: 'doc',
        workspaceId: pages.ws,
        id: doc.id,
        name: doc.title,
      }),
  });

  const styles = {
    row: cn(
      'group',
      sidebarRow.base,
      selectedPageId === doc.id ? sidebarRow.selected : sidebarRow.default,
    ),
    // Leaf pages keep the (hidden) chevron so icons stay aligned.
    chevronButton: cn('shrink-0', !hasChildren && 'invisible'),
    chevronIcon: cn('transition-transform', isExpanded && 'rotate-90'),
    label: 'flex-1 truncate',
    menuWrap: 'flex shrink-0',
    // Hidden until the row is hovered; stays visible while its menu is open.
    menuTrigger: cn('group-hover:flex', isMenuOpen ? 'flex' : 'hidden'),
    rowStyle: { paddingLeft: BASE_INDENT + depth * INDENT_STEP } as CSSProperties,
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isActivationKey = e.key === 'Enter' || e.key === ' ';
    if (!isActivationKey) return;
    e.preventDefault();
    selectPage(doc.id);
  };

  return (
    <>
      <div
        className={styles.row}
        style={styles.rowStyle}
        role="button"
        tabIndex={0}
        onClick={() => selectPage(doc.id)}
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
          aria-label={isExpanded ? 'Collapse page' : 'Expand page'}
          onClick={() => toggle(doc.id)}
          icon={<ChevronRightOutlined variant="subtle" className={styles.chevronIcon} />}
        />

        <PageFoldPortraitOutlined variant="subtle" size="xxx-small" />
        <span className={styles.label}>{doc.title}</span>

        {menuItems.length > 0 && (
          <span className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
            <Dropdown
              placement="bottomRight"
              visible={isMenuOpen}
              onVisibleChange={setIsMenuOpen}
              overlay={
                <DropdownMenu
                  dsVersion="2.0"
                  options={menuItems}
                  onClick={(option: PageMenuOption) =>
                    menuItems.find((item) => item.key === option.key)?.onSelect?.()
                  }
                />
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  dsVersion="2.0"
                  type="plain"
                  variant="neutral"
                  size="x-small"
                  isCompact
                  isActivated={isMenuOpen}
                  className={styles.menuTrigger}
                  aria-label="Page actions"
                  icon={<DotsHorizontalOutlined variant="subtle" />}
                />
              </span>
            </Dropdown>
          </span>
        )}
      </div>

      {isExpanded &&
        children.map((child) => (
          <PageRow key={child.doc.id} node={child} depth={depth + 1} pages={pages} />
        ))}
    </>
  );
}
