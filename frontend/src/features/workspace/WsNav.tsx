import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import {
  HomeOutlined,
  StarOutlined,
  BellRingOutlined,
  MultipleUsersOutlined,
  SettingsOutlined,
  ChevronLeftOutlined,
} from '@toddle-edu/ds-icons';
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
          <HomeOutlined variant="subtle" size="xxx-small" />
          Home
        </div>
        <div className={s.qkRow}>
          <StarOutlined variant="subtle" size="xxx-small" />
          Starred
        </div>
      </div>

      <PagesTree ctx={ctx} />

      <div className={s.wsNavFoot}>
        {isAdmin && (
          <NavLink
            to={`/w/${workspaceId}/requests`}
            className={({ isActive }) => cn(s.qkRow, isActive && s.active)}
          >
            {({ isActive }) => (
              <>
                <BellRingOutlined
                  size="xxx-small"
                  variant={isActive ? undefined : 'subtle'}
                  overrideVariantStyles={isActive}
                />
                Requests
                <span className={`${s.qkCt} ${s.alert}`}>{requests?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink
            to={`/w/${workspaceId}/members`}
            className={({ isActive }) => cn(s.qkRow, isActive && s.active)}
          >
            {({ isActive }) => (
              <>
                <MultipleUsersOutlined
                  size="xxx-small"
                  variant={isActive ? undefined : 'subtle'}
                  overrideVariantStyles={isActive}
                />
                Members
                <span className={s.qkCt}>{members?.length ?? 0}</span>
              </>
            )}
          </NavLink>
        )}
        <div className={s.qkRow}>
          <SettingsOutlined variant="subtle" size="xxx-small" />
          Workspace settings
        </div>
        <div
          className={s.qkRow}
          role="button"
          onClick={() => leave.mutate()}
          style={{ color: 'var(--text-secondary)' }}
        >
          <ChevronLeftOutlined variant="subtle" size="xxx-small" />
          {isAdmin ? 'All workspaces' : 'Launcher'}
        </div>
      </div>
    </aside>
  );
}
