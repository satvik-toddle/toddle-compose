import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronRightOutlined, DotsHorizontalOutlined } from '@toddle-edu/ds-icons';
import { Dropdown, DropdownMenu, IconButton, Tooltip } from '@toddle-edu/ds-web';
import { pushToast, useUiStore } from '../../../../stores/uiStore';
import { useToggleStar } from '../../../../hooks/usePages';
import { useIsTruncated } from '../../../../hooks/useIsTruncated';
import { cn } from '../../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';
import { pageTypeIcon } from '../../pageTypes';
import type { TreeDoc } from '../../pagesModel';
import { buildPageMenuItems, findPageMenuOption, type PageMenuOption } from './pageMenuItems';
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
  const toggleStar = useToggleStar();
  const { doc, children } = node;
  const isStarred = !!doc.isStarred;
  const docUrl = `${window.location.origin}/w/${pages.ws}?doc=${doc.id}`;
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(doc.id);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { elementRef: labelRef, isTruncated } = useIsTruncated<HTMLSpanElement>(doc.title);
  const PageIcon = pageTypeIcon(doc.type);

  const menuItems = buildPageMenuItems({
    canCreate,
    canManage: canManage(doc.owner.id),
    isStarred,
    onAddSubpage: (type) => createPage(doc.id, type),
    onAddPage: (type) => createPage(doc.parentId ?? undefined, type),
    onToggleStar: () => toggleStar.mutate({ workspaceId: pages.ws, id: doc.id, isStarred }),
    onCopyLink: async () => {
      await navigator.clipboard.writeText(docUrl);
      pushToast({ kind: 'success', message: 'Link copied' });
    },
    onOpenInNewTab: () => window.open(docUrl, '_blank', 'noopener,noreferrer'),
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
    // min-w-0 lets the flex item shrink below its content so truncate shows the ellipsis.
    label: 'min-w-0 flex-1 truncate',
    menuWrap: 'flex shrink-0',
    // Transparent (but focusable) until row hover, keyboard focus, or menu open.
    menuTrigger: cn(
      'opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
      isMenuOpen && 'opacity-100',
    ),
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
      {/* Tooltip wraps the focusable row so it surfaces on hover AND keyboard focus,
          but only when the title is actually clipped. */}
      <Tooltip dsVersion="2.0" placement="right" showArrow tooltip={isTruncated ? doc.title : ''}>
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

          <PageIcon variant="subtle" size="xxx-small" />
          <span ref={labelRef} className={styles.label}>
            {doc.title}
          </span>

          {menuItems.length > 0 && (
            <span
              className={styles.menuWrap}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Dropdown
                placement="bottomRight"
                visible={isMenuOpen}
                onVisibleChange={setIsMenuOpen}
                overlay={
                  <DropdownMenu
                    dsVersion="2.0"
                    options={menuItems}
                    onClick={(option: PageMenuOption) =>
                      findPageMenuOption(menuItems, option.key)?.onSelect?.()
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
      </Tooltip>

      {isExpanded &&
        children.map((child) => (
          <PageRow key={child.doc.id} node={child} depth={depth + 1} pages={pages} />
        ))}
    </>
  );
}
