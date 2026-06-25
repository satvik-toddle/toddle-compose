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
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);

  if (!me) return null;

  // Single toolbar: the workspace switcher + (when a page is open) a breadcrumb on
  // the left, and the page's contextual actions on the right. There is no second
  // (per-page) toolbar — this owns the doc title, Share, and the ⋯ page menu.
  const docId = params.get('doc');
  const doc = docId ? docs.find((d) => d.id === docId) : undefined;

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <SidebarToggle onToggle={onToggleSidebar} />
        <WorkspaceSwitcher ctx={ctx} />
        {doc && <DocBreadcrumb title={doc.title} />}
      </div>
      <div className={styles.right}>
        <DocActions ctx={ctx} doc={doc} me={me} />
        <AcctPill me={me} realmRole={realm?.role} compact />
      </div>
    </div>
  );
}
