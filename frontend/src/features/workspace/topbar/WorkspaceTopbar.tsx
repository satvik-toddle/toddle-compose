import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccountMenu } from '../../../components/AccountMenu';
import { useRealm } from '../../../hooks/queries';
import { useDocuments } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
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
};

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
  const { data: realm } = useRealm();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);

  if (!currentUser) return null;

  // The currently open page, if any (driven by the ?doc= query param).
  const openDocId = params.get('doc');
  const doc = openDocId ? docs.find((d) => d.id === openDocId) : undefined;
  const trail = useMemo(() => (doc ? buildBreadcrumbTrail(doc, docs) : []), [doc, docs]);

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {doc && <span className={styles.divider} aria-hidden />}
        {doc && <DocBreadcrumb trail={trail} workspaceId={ctx.workspaceId} />}
      </div>
      <div className={styles.right}>
        <DocActions ctx={ctx} doc={doc} user={currentUser} />
        <AccountMenu user={currentUser} realmRole={realm?.role} compact />
      </div>
    </div>
  );
}
