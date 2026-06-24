import { NavLink, useNavigate } from 'react-router-dom';
import { SearchInput, Badge } from '@toddle-edu/ds-web';
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
      {/* Non-functional stub today (workspace search isn't wired up yet); kept read-only so it reads as a placeholder, not a broken field. */}
      <div className="mb-2">
        <SearchInput
          dsVersion="2.0"
          size="medium"
          placeholder="Search this workspace…"
          aria-label="Search this workspace"
          readOnly
        />
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
                <span className="ml-auto">
                  <Badge
                    dsVersion="2.0"
                    type="numeric"
                    variant="notifications"
                    size="xxx-small"
                    value={requests?.length ?? 0}
                    showZero
                  />
                </span>
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
                <span className="ml-auto">
                  <Badge
                    dsVersion="2.0"
                    type="numeric"
                    variant="subtle"
                    size="xxx-small"
                    value={members?.length ?? 0}
                    showZero
                  />
                </span>
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
