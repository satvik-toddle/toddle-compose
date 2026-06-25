import { useSearchParams } from 'react-router-dom';
import { AcctPill } from '../../../components/AcctPill';
import { useRealm } from '../../../hooks/queries';
import { useDocuments } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import type { WorkspaceCtx } from '../context';
import { SidebarToggle } from './SidebarToggle';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { DocBreadcrumb } from './DocBreadcrumb';
import { DocActions } from './DocActions';

const styles = {
  bar: 'flex flex-none items-center justify-between h-14 pl-3 pr-4 bg-surface-primary-enabled border-b border-secondary',
  left: 'flex items-center gap-1 min-w-0',
  right: 'flex items-center gap-2',
};

export function WorkspaceTopbar({
  ctx,
  onToggleSidebar,
}: Readonly<{ ctx: WorkspaceCtx; onToggleSidebar: () => void }>) {
  const currentUser = useAuthStore((state) => state.user);
  const { data: realm } = useRealm();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);

  if (!currentUser) return null;

  // The currently open page, if any (driven by the ?doc= query param).
  const openDocId = params.get('doc');
  const doc = openDocId ? docs.find((d) => d.id === openDocId) : undefined;

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <SidebarToggle onToggle={onToggleSidebar} />
        <WorkspaceSwitcher ctx={ctx} />
        {doc && <DocBreadcrumb title={doc.title} />}
      </div>
      <div className={styles.right}>
        <DocActions ctx={ctx} doc={doc} me={currentUser} />
        <AcctPill user={currentUser} realmRole={realm?.role} compact />
      </div>
    </div>
  );
}
