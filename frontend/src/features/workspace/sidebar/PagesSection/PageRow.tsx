import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronRightOutlined, DotsHorizontalOutlined } from '@toddle-edu/ds-icons';
import { Dropdown, DropdownMenu, IconButton, Tooltip } from '@toddle-edu/ds-web';
import { pushToast, useUiStore } from '../../../../stores/uiStore';
import { useRenameDocument, useToggleStar } from '../../../../hooks/usePages';
import { useDocCodaMappings } from '../../../../hooks/useMigrations';
import { useIsTruncated } from '../../../../hooks/useIsTruncated';
import { cn } from '../../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';
import { pageTypeIcon } from '../../pageTypes';
import type { TreeDoc } from '../../pagesModel';
import { buildPageMenuItems, findPageMenuOption, type PageMenuOption } from './pageMenuItems';
import { RenameInput } from './RenameInput';
import type { PagesSectionController } from './usePagesSection';

const BASE_INDENT = 4;
const INDENT_STEP = 15;

export function PageRow({
  node,
  depth,
  pages,
}: Readonly<{ node: TreeDoc; depth: number; pages: PagesSectionController }>) {
  const { expanded, selectedPageId, canCreate, canManage, toggle, selectPage, createPage } = pages;
  const openModal = useUiStore((st) => st.openModal);
  const toggleStar = useToggleStar();
  const renameDoc = useRenameDocument();
  const { doc, children } = node;
  const isStarred = !!doc.isStarred;
  const docUrl = `${window.location.origin}/w/${pages.ws}?doc=${doc.id}`;
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(doc.id);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const { elementRef: labelRef, isTruncated } = useIsTruncated<HTMLSpanElement>(doc.title);
  const PageIcon = pageTypeIcon(doc.type);

  // "Open in Coda" destinations, fetched only once this row's menu opens (editor+),
  // so we don't fire a query per page row up front.
  const { data: codaMappings } = useDocCodaMappings(doc.id, canCreate && isMenuOpen);

  // Close menu first: rename unmounts the Dropdown, which else remounts with stale visible=true.
  const handleRename = () => {
    setIsMenuOpen(false);
    setIsRenaming(true);
  };

  const menuItems = buildPageMenuItems({
    canCreate,
    canManage: canManage(doc.owner.id, doc.myRole),
    isStarred,
    onAddSubpage: (type) => createPage(doc.id, type),
    onAddPage: (type) => createPage(doc.parentId ?? undefined, type),
    onToggleStar: () => toggleStar.mutate({ workspaceId: pages.ws, id: doc.id, isStarred }),
    onCopyLink: async () => {
      await navigator.clipboard.writeText(docUrl);
      pushToast({ kind: 'success', message: 'Link copied' });
    },
    onOpenInNewTab: () => window.open(docUrl, '_blank', 'noopener,noreferrer'),
    onRename: handleRename,
    onDelete: () =>
      openModal({
        type: 'confirmDeletePage',
        kind: 'doc',
        workspaceId: pages.ws,
        id: doc.id,
        name: doc.title,
      }),
    // Copy to Coda is a workspace editor+ action; canCreate is that same gate.
    onCopyToCoda: canCreate
      ? () => openModal({ type: 'copyToCoda', docId: doc.id, workspaceId: pages.ws })
      : undefined,
    onImportFromCoda: canCreate
      ? () => openModal({ type: 'importPageFromCoda', docId: doc.id, workspaceId: pages.ws })
      : undefined,
    codaMappings: canCreate ? codaMappings : undefined,
  });

  const styles = {
    row: cn(
      'group',
      sidebarRow.base,
      // [&_input]: the DS TextInput pins text-body (weight 500) on its inner input,
      // so the selected row's semibold must be forced onto it for inline rename.
      selectedPageId === doc.id
        ? cn(sidebarRow.selected, '[&_input]:font-semibold')
        : sidebarRow.default,
    ),
    // Leaf pages keep a hidden chevron for alignment; negative margin tightens the icon gap.
    chevronButton: cn('-mr-2 shrink-0', !hasChildren && 'invisible'),
    chevronIcon: cn('transition-transform', isExpanded && 'rotate-90'),
    // min-w-0 lets the flex item shrink so truncate shows the ellipsis.
    label: 'min-w-0 flex-1 truncate',
    menuWrap: 'flex shrink-0',
    // Hidden (but focusable) until row hover, focus, or menu open.
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

  const handleRowDoubleClick = () => {
    if (canManage(doc.owner.id, doc.myRole)) setIsRenaming(true);
  };

  const commitRename = (value: string) => {
    setIsRenaming(false);
    const title = value.trim();
    if (!title || title === doc.title) return;
    renameDoc.mutate({ workspaceId: pages.ws, id: doc.id, title });
  };

  const cancelRename = () => setIsRenaming(false);

  const titleContent = isRenaming ? (
    <RenameInput initial={doc.title} onCommit={commitRename} onCancel={cancelRename} />
  ) : (
    <span ref={labelRef} className={styles.label}>
      {doc.title}
    </span>
  );

  return (
    <>
      {/* Tooltip on the row: hover/focus, only when the title is clipped. */}
      <Tooltip
        dsVersion="2.0"
        placement="right"
        showArrow
        tooltip={isTruncated && !isRenaming ? doc.title : ''}
      >
        <div
          className={styles.row}
          style={styles.rowStyle}
          role="button"
          tabIndex={0}
          onClick={() => selectPage(doc.id)}
          onDoubleClick={handleRowDoubleClick}
          onKeyDown={handleRowKeyDown}
        >
          <IconButton
            dsVersion="2.0"
            type="plain"
            variant="neutral"
            size="x-small"
            shouldStopPropagation
            className={styles.chevronButton}
            aria-label={isExpanded ? 'Collapse page' : 'Expand page'}
            onClick={() => toggle(doc.id)}
            icon={<ChevronRightOutlined variant="subtle" className={styles.chevronIcon} />}
          />

          <PageIcon variant="subtle" size="xxx-small" />
          {titleContent}

          {!isRenaming && menuItems.length > 0 && (
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
