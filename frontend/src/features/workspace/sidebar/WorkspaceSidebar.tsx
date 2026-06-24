import { NavLink, useSearchParams } from 'react-router-dom';
import { SearchInput, Badge } from '@toddle-edu/ds-web';
import {
  HomeOutlined,
  StarOutlined,
  BellRingOutlined,
  MultipleUsersOutlined,
  SettingsOutlined,
  ChevronLeftOutlined,
} from '@toddle-edu/ds-icons';
import { useWorkspaceJoinRequests, useWorkspaceMembers } from '../../../hooks/queries';
import { useLeaveWorkspace } from '../../../hooks/useAuthMutations';
import { cn } from '../../../lib/cn';
import { PagesSection } from './PagesSection';
import { sidebarRow } from './sidebarRowStyles';
import type { WorkspaceCtx } from '../WorkspaceLayout';

const styles = {
  sidebar:
    'flex w-[266px] flex-none flex-col overflow-auto border-r border-secondary bg-surface-secondary-enabled p-2.5 transition-[margin-left] duration-200 ease-in-out',
  sidebarCollapsed: '-ml-[266px]',
  linkGroup: 'flex flex-col gap-0.25',
  footerGroup: 'mt-auto flex flex-col gap-0.25 border-t border-secondary pt-2.5',
};

type WorkspaceSidebarProps = { ctx: WorkspaceCtx; collapsed?: boolean };

export function WorkspaceSidebar({ ctx, collapsed }: Readonly<WorkspaceSidebarProps>) {
  const { workspaceId, isAdmin } = ctx;
  const leave = useLeaveWorkspace();
  const [searchParams] = useSearchParams();
  const hasOpenDoc = !!searchParams.get('doc');
  const { data: members } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);

  return (
    <aside className={cn(styles.sidebar, collapsed && styles.sidebarCollapsed)}>
      {/* Read-only stub until workspace search is wired up. */}
      <div className="mb-2">
        <SearchInput
          dsVersion="2.0"
          size="medium"
          placeholder="Search this workspace…"
          aria-label="Search this workspace"
          readOnly
        />
      </div>

      <div className={styles.linkGroup}>
        <NavLink
          to={`/w/${workspaceId}`}
          end
          className={({ isActive }) =>
            cn(sidebarRow.base, isActive && !hasOpenDoc ? sidebarRow.selected : sidebarRow.default)
          }
        >
          <HomeOutlined size="xxx-small" />
          Home
        </NavLink>
        <div className={cn(sidebarRow.base, sidebarRow.default)}>
          <StarOutlined size="xxx-small" />
          Starred
        </div>
      </div>

      <PagesSection ctx={ctx} />

      <div className={styles.footerGroup}>
        {isAdmin && (
          <NavLink
            to={`/w/${workspaceId}/requests`}
            className={({ isActive }) =>
              cn(sidebarRow.base, isActive ? sidebarRow.selected : sidebarRow.default)
            }
          >
            <BellRingOutlined size="xxx-small" />
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
          </NavLink>
        )}
        {isAdmin && (
          <NavLink
            to={`/w/${workspaceId}/members`}
            className={({ isActive }) =>
              cn(sidebarRow.base, isActive ? sidebarRow.selected : sidebarRow.default)
            }
          >
            <MultipleUsersOutlined size="xxx-small" />
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
          </NavLink>
        )}
        <div className={cn(sidebarRow.base, sidebarRow.default)}>
          <SettingsOutlined size="xxx-small" />
          Workspace settings
        </div>
        <button
          type="button"
          className={cn(sidebarRow.base, sidebarRow.default)}
          onClick={() => leave.mutate()}
        >
          <ChevronLeftOutlined size="xxx-small" />
          {isAdmin ? 'All workspaces' : 'Launcher'}
        </button>
      </div>
    </aside>
  );
}
