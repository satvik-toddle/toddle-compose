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
import { useWorkspaceJoinRequests, useWorkspaceMembers } from '../../hooks/queries';
import { useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { cn } from '../../lib/cn';
import { PagesTree } from './PagesTree';
import type { WorkspaceCtx } from './WorkspaceLayout';

const styles = {
  sidebar:
    'flex w-[266px] flex-none flex-col overflow-auto border-r border-secondary bg-surface-secondary-enabled p-2.5 transition-[margin-left] duration-200 ease-in-out',
  sidebarCollapsed: '-ml-[266px]',
  linkGroup: 'flex flex-col gap-0.25',
  footerGroup: 'mt-auto flex flex-col gap-0.25 border-t border-secondary pt-2.5',
  link: 'flex items-center gap-2.5 rounded-2 px-2.25 py-1.5 text-body-s no-underline',
  // hover:text-* pins the row color through hover so the NavLink <a> rows don't
  // inherit antd's global teal link-hover color.
  linkDefault: 'text-primary hover:bg-surface-secondary-hover hover:text-primary',
  linkSelected: 'bg-surface-primary-selected text-primary hover:text-primary',
  linkSubtle: 'text-secondary hover:bg-surface-secondary-hover hover:text-secondary',
};

export function WsNav({ ctx, collapsed }: { ctx: WorkspaceCtx; collapsed?: boolean }) {
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
            cn(styles.link, isActive && !hasOpenDoc ? styles.linkSelected : styles.linkDefault)
          }
        >
          {({ isActive }) => (
            <>
              <HomeOutlined
                size="xxx-small"
                variant={isActive && !hasOpenDoc ? 'default' : 'subtle'}
              />
              Home
            </>
          )}
        </NavLink>
        <div className={cn(styles.link, styles.linkDefault)}>
          <StarOutlined variant="subtle" size="xxx-small" />
          Starred
        </div>
      </div>

      <PagesTree ctx={ctx} />

      <div className={styles.footerGroup}>
        {isAdmin && (
          <NavLink
            to={`/w/${workspaceId}/requests`}
            className={({ isActive }) =>
              cn(styles.link, isActive ? styles.linkSelected : styles.linkDefault)
            }
          >
            {({ isActive }) => (
              <>
                <BellRingOutlined size="xxx-small" variant={isActive ? 'default' : 'subtle'} />
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
            className={({ isActive }) =>
              cn(styles.link, isActive ? styles.linkSelected : styles.linkDefault)
            }
          >
            {({ isActive }) => (
              <>
                <MultipleUsersOutlined size="xxx-small" variant={isActive ? 'default' : 'subtle'} />
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
        <div className={cn(styles.link, styles.linkDefault)}>
          <SettingsOutlined variant="subtle" size="xxx-small" />
          Workspace settings
        </div>
        <div
          className={cn(styles.link, styles.linkSubtle)}
          role="button"
          onClick={() => leave.mutate()}
        >
          <ChevronLeftOutlined variant="subtle" size="xxx-small" />
          {isAdmin ? 'All workspaces' : 'Launcher'}
        </div>
      </div>
    </aside>
  );
}
