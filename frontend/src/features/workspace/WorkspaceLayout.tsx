import { Outlet, useParams } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { PageLoader } from '../../components/Loader';
import { WorkspaceSidebar } from './sidebar';
import { WorkspaceTopbar } from './topbar';
import { useRealm, useWorkspace } from '../../hooks/queries';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { effectiveWorkspaceRole } from '../../lib/roles';
import { useSidebarCollapse } from './useSidebarCollapse';
import { useFullScreenMode } from './useFullScreenMode';
import { FullScreenControls } from './FullScreenControls';
import type { WorkspaceCtx } from './context';

// Re-exported so existing callers can keep importing from './WorkspaceLayout'.
export { useWorkspaceCtx } from './context';
export type { WorkspaceCtx } from './context';

const styles = {
  shell: 'flex min-h-0 flex-1 overflow-hidden',
  // min-w-0 + overflow-hidden so wide editors scroll internally instead of growing the page.
  content: 'flex min-w-0 flex-1 flex-col overflow-hidden',
};

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: ws, isLoading } = useWorkspace(workspaceId);
  const { data: realm } = useRealm();
  // Live sidebar: refetch the doc list when another member changes a doc.
  useWorkspaceEvents(workspaceId);
  const { collapsed, toggle } = useSidebarCollapse();
  // Sole owner of the full-screen hotkeys (Esc / Cmd+Shift+F) — see useFullScreenMode.
  const fullScreen = useFullScreenMode({ bindHotkeys: true });

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
      <div className={styles.shell}>
        {!fullScreen.active && <WorkspaceSidebar ctx={ctx} collapsed={collapsed} />}
        <div className={cn(styles.content, fullScreen.active && 'relative')}>
          {!fullScreen.active && (
            <WorkspaceTopbar ctx={ctx} sidebarCollapsed={collapsed} onToggleSidebar={toggle} />
          )}
          {fullScreen.active && <FullScreenControls ctx={ctx} />}
          <Outlet context={ctx} />
        </div>
      </div>
    </div>
  );
}
