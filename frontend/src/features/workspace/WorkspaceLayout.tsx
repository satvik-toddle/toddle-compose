import { Outlet, useParams } from 'react-router-dom';
import { PageLoader } from '../../components/Loader';
import { WorkspaceSidebar } from './sidebar';
import { WorkspaceTopbar } from './topbar';
import { useRealm, useWorkspace } from '../../hooks/queries';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { effectiveWorkspaceRole } from '../../lib/roles';
import { useSidebarCollapse } from './useSidebarCollapse';
import type { WorkspaceCtx } from './context';

// Re-exported so existing callers can keep importing from './WorkspaceLayout'.
export { useWorkspaceCtx } from './context';
export type { WorkspaceCtx } from './context';

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: ws, isLoading } = useWorkspace(workspaceId);
  const { data: realm } = useRealm();
  // Live sidebar: refetch the doc list when another member changes a doc.
  useWorkspaceEvents(workspaceId);
  const { collapsed, toggle } = useSidebarCollapse();

  if (isLoading || !ws || !workspaceId) {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }

  const { role, overlay } = effectiveWorkspaceRole(realm?.role, ws.role);
  const ctx: WorkspaceCtx = {
    workspaceId,
    name: ws.name,
    role: role ?? ws.role,
    isAdmin: role === 'ADMIN',
    overlay,
    realmRole: realm?.role ?? null,
  };

  return (
    <div className="rbac">
      <WorkspaceTopbar ctx={ctx} sidebarCollapsed={collapsed} onToggleSidebar={toggle} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WorkspaceSidebar ctx={ctx} collapsed={collapsed} />
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
