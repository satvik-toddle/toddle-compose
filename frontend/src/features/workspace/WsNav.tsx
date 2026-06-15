import { NavLink } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useWorkspaceJoinRequests, useWorkspaceMembers } from '../../hooks/queries';
import { useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { cn } from '../../lib/cn';
import { PagesTree } from './PagesTree';
import type { WorkspaceCtx } from './WorkspaceLayout';

export function WsNav({ ctx }: { ctx: WorkspaceCtx }) {
  const { workspaceId, isAdmin } = ctx;
  const leave = useLeaveWorkspace();
  const { data: members } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);

  return (
    <aside className="ws-nav">
      <div className="ws-nav-search">
        <Icon name="SearchOutlined" size={14} muted />
        <input placeholder="Search this workspace…" readOnly />
      </div>

      <div className="ws-nav-quick">
        <div className="qk-row">
          <Icon name="HomeOutlined" size={16} muted />
          Home
        </div>
        <div className="qk-row">
          <Icon name="StarOutlined" size={16} muted />
          Starred
        </div>
      </div>

      <PagesTree ctx={ctx} />

      <div className="ws-nav-foot">
        {isAdmin && (
          <NavLink to={`/w/${workspaceId}/requests`} className={({ isActive }) => cn('qk-row', isActive && 'active')}>
            {({ isActive }) => (
              <>
                <Icon name="BellRingOutlined" size={16} muted={!isActive} />
                Requests
                <span className="qk-ct alert">{requests?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to={`/w/${workspaceId}/members`} className={({ isActive }) => cn('qk-row', isActive && 'active')}>
            {({ isActive }) => (
              <>
                <Icon name="MultipleUsersOutlined" size={16} muted={!isActive} />
                Members
                <span className="qk-ct">{members?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        <div className="qk-row">
          <Icon name="SettingsOutlined" size={16} muted />
          Workspace settings
        </div>
        <div
          className="qk-row"
          role="button"
          onClick={() => leave.mutate()}
          style={{ color: 'var(--text-secondary)' }}
        >
          <Icon name="ChevronLeftOutlined" size={16} muted />
          {isAdmin ? 'All workspaces' : 'Launcher'}
        </div>
      </div>
    </aside>
  );
}
