import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IconButton, Tooltip } from '@toddle-edu/ds-web';
import { SearchOutlined } from '@toddle-edu/ds-icons';
import { AccountMenu } from '../../../components/AccountMenu';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { commandModifierKey } from '../../../lib/platform';
import { useRealm } from '../../../hooks/queries';
import { useDocuments, useOpenDoc } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import type { WorkspaceCtx } from '../context';
import { SidebarToggle } from './SidebarToggle';
import { DocBreadcrumb } from './DocBreadcrumb';
import { buildBreadcrumbTrail } from './ancestorTrail';
import { DocActions } from './DocActions';

const styles = {
  bar: 'flex flex-none items-center justify-between h-14 pl-3 pr-4 bg-surface-primary-enabled',
  left: 'flex items-center gap-1 min-w-0',
  right: 'flex items-center gap-2',
  divider: 'ml-1 mr-3 h-5 w-px flex-none bg-[var(--border-secondary)]',
  tooltip: 'flex items-center gap-2',
};

const searchShortcutKeys = [commandModifierKey, 'K'];

export function WorkspaceTopbar({
  ctx,
  sidebarCollapsed,
  onToggleSidebar,
}: Readonly<{
  ctx: WorkspaceCtx;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}>) {
  const currentUser = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const { data: realm } = useRealm();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);

  // The open page (?doc=). Resolved via useOpenDoc so a doc outside the paginated list still
  // gets a breadcrumb + Share/Delete actions. For a fetched (out-of-list) doc, the trail comes
  // from its authoritative backend breadcrumbs; the docs-list walk can't see unloaded ancestors.
  const openDocId = params.get('doc');
  const { doc, fetched } = useOpenDoc(openDocId ?? undefined, docs);
  const trail = useMemo(
    () =>
      fetched?.breadcrumbs
        ? fetched.breadcrumbs.map((b) => ({ id: b.id, title: b.title }))
        : doc
          ? buildBreadcrumbTrail(doc, docs)
          : [],
    [doc, fetched, docs],
  );

  if (!currentUser) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {doc && <span className={styles.divider} aria-hidden />}
        {doc && <DocBreadcrumb trail={trail} workspaceId={ctx.workspaceId} />}
      </div>
      <div className={styles.right}>
        <Tooltip
          dsVersion="2.0"
          showArrow
          tooltip={
            <span className={styles.tooltip}>
              Search
              <ShortcutHint keys={searchShortcutKeys} />
            </span>
          }
        >
          <IconButton
            dsVersion="2.0"
            variant="neutral"
            type="plain"
            icon={<SearchOutlined />}
            aria-label="Search docs"
            data-testid="topbar-search"
            onClick={() => openModal({ type: 'search', workspaceId: ctx.workspaceId })}
          />
        </Tooltip>
        <DocActions ctx={ctx} doc={doc} user={currentUser} />
        <AccountMenu user={currentUser} realmRole={realm?.role} />
      </div>
    </div>
  );
}
