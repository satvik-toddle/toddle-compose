import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useWorkspaceJoinRequests, useWorkspaceMembers } from '../../hooks/queries';
import { useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { cn } from '../../lib/cn';
import { PagesTree } from './PagesTree';
import type { WorkspaceCtx } from './WorkspaceLayout';
import s from './WsNav.module.scss';

export function WsNav({ ctx, collapsed }: { ctx: WorkspaceCtx; collapsed?: boolean }) {
  const { workspaceId, isAdmin } = ctx;
  const navigate = useNavigate();
  const leave = useLeaveWorkspace();
  const { data: members } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);

  return (
    <aside className={cn(s.wsNav, collapsed && s.collapsed)}>
      <div className={s.wsNavSearch}>
        <Icon name="SearchOutlined" size={14} muted />
        <input placeholder="Search this workspace…" readOnly />
      </div>

      <div className={s.wsNavQuick}>
        <div className={s.qkRow} role="button" onClick={() => navigate(`/w/${workspaceId}`)}>
          <Icon name="HomeOutlined" size={16} muted />
          Home
        </div>
        <div className={s.qkRow}>
          <Icon name="StarOutlined" size={16} muted />
          Starred
        </div>
      </div>

      <PagesTree ctx={ctx} />

      <div className={s.wsNavFoot}>
        {isAdmin && (
          <NavLink to={`/w/${workspaceId}/requests`} className={({ isActive }) => cn(s.qkRow, isActive && s.active)}>
            {({ isActive }) => (
              <>
                <Icon name="BellRingOutlined" size={16} muted={!isActive} />
                Requests
                <span className={`${s.qkCt} ${s.alert}`}>{requests?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to={`/w/${workspaceId}/members`} className={({ isActive }) => cn(s.qkRow, isActive && s.active)}>
            {({ isActive }) => (
              <>
                <Icon name="MultipleUsersOutlined" size={16} muted={!isActive} />
                Members
                <span className={s.qkCt}>{members?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        <div className={s.qkRow}>
          <Icon name="SettingsOutlined" size={16} muted />
          Workspace settings
        </div>
        <div
          className={s.qkRow}
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
