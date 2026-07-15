import { useRef } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { Badge } from '@toddle-edu/ds-web';
import {
  HomeOutlined,
  StarOutlined,
  SettingsOutlined,
  ChevronLeftOutlined,
  AddOutlined,
  DotsSixVerticalOutlined,
} from '@toddle-edu/ds-icons';
import { useWorkspaceJoinRequests } from '../../../hooks/queries';
import { useLeaveWorkspace } from '../../../hooks/useAuthMutations';
import { useUiStore } from '../../../stores/uiStore';
import { cn } from '../../../lib/cn';
import { PagesSection, usePagesSection } from './PagesSection';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { CreatePageDropdown } from '../CreatePageDropdown';
import { sidebarRow } from './sidebarRowStyles';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from './constants';
import { useSidebarWidth } from './useSidebarWidth';
import type { WorkspaceCtx } from '../WorkspaceLayout';

const styles = {
  // No overflow-hidden: the resize knob straddles the right border; collapse is
  // already clipped by the parent layout container.
  sidebar:
    'relative flex flex-none flex-col border-r border-secondary bg-surface-secondary-enabled p-2.5 transition-[margin-left] duration-200 ease-in-out',
  // 6px hit-area on the right edge; the 2px bar inside lights up on hover/focus/drag.
  // outline-none: the blue bar is the focus indicator, so drop the default focus ring.
  resizeHandle:
    'group/resize absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize focus:outline-none',
  resizeBar:
    'pointer-events-none absolute right-0 top-0 h-full w-0.5 transition-colors duration-150 group-hover/resize:bg-[var(--border-focus)] group-focus-visible/resize:bg-[var(--border-focus)]',
  resizeBarActive: 'bg-[var(--border-focus)]',
  // Grip knob: a centered tab (surface + border + shadow) holding the grip icon, so the
  // handle reads as resizable — including on keyboard focus, where there's no resize cursor.
  resizeKnob:
    'pointer-events-none absolute right-0 top-1/2 flex h-6 w-4 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-1 border border-secondary bg-surface-primary-enabled text-secondary shadow-elevation-2-bottom opacity-0 transition-opacity duration-150 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100',
  resizeKnobActive: 'opacity-100',
  // Pinned top (nav + heading) and bottom (footer); only the body scrolls.
  header: 'flex-none border-b border-secondary',
  // Full-bleed row (cancels the sidebar padding) so the switcher spans edge to edge.
  switcherRow: '-mx-2.5 -mt-2.5 mb-1 flex h-14 items-center px-2.5 [&>*]:w-full',
  // -mx/px gives the scroll area room for the focus ring without misaligning rows.
  body: 'flex-1 min-h-0 overflow-y-auto -mx-2.5 px-2.5 pt-1.5',
  linkGroup: 'flex flex-col gap-0.25',
  sectionHeading: 'flex items-center px-2.25 pt-2 pb-2 text-label-xs uppercase text-secondary',
  footerGroup: 'flex flex-none flex-col gap-0.25 border-t border-secondary pt-2.5',
};

type WorkspaceSidebarProps = { ctx: WorkspaceCtx; collapsed?: boolean };

export function WorkspaceSidebar({ ctx, collapsed }: Readonly<WorkspaceSidebarProps>) {
  const { workspaceId, isAdmin } = ctx;
  const leave = useLeaveWorkspace();
  const openModal = useUiStore((s) => s.openModal);
  const [searchParams] = useSearchParams();
  const hasOpenDoc = !!searchParams.get('doc');
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);
  const hasPendingRequests = !!requests?.length;
  const pages = usePagesSection(ctx);
  const { width, isResizing, startResize, handleResizeKeyDown } = useSidebarWidth();
  // The scroll container for the pages list; passed to PagesSection so lazy-load doesn't
  // have to discover it by walking the DOM for a computed overflow style.
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <aside className={styles.sidebar} style={{ width, marginLeft: collapsed ? -width : 0 }}>
      <div className={styles.header}>
        <div className={styles.switcherRow}>
          <WorkspaceSwitcher ctx={ctx} />
        </div>

        <div className={styles.linkGroup}>
          <NavLink
            to={`/w/${workspaceId}`}
            end
            className={({ isActive }) =>
              cn(
                sidebarRow.base,
                isActive && !hasOpenDoc ? sidebarRow.selected : sidebarRow.default,
              )
            }
          >
            <HomeOutlined size="xxx-small" />
            Home
          </NavLink>
          <NavLink
            to={`/w/${workspaceId}/starred`}
            className={({ isActive }) =>
              cn(sidebarRow.base, isActive ? sidebarRow.selected : sidebarRow.default)
            }
          >
            <StarOutlined size="xxx-small" />
            Starred
          </NavLink>
        </div>

        <div className={styles.sectionHeading}>Pages</div>
      </div>

      <div ref={bodyRef} className={styles.body}>
        <PagesSection pages={pages} scrollRef={bodyRef} />
      </div>

      <div className={styles.footerGroup}>
        {pages.canCreate && (
          <CreatePageDropdown
            placement="topLeft"
            onCreate={(type) => pages.createPage(undefined, type)}
          >
            <button type="button" className={cn(sidebarRow.base, sidebarRow.default, 'w-full')}>
              <AddOutlined size="xxx-small" />
              New page
            </button>
          </CreatePageDropdown>
        )}
        <button
          type="button"
          className={cn(sidebarRow.base, sidebarRow.default)}
          onClick={() =>
            openModal({ type: 'workspaceSettings', workspaceId, workspaceName: ctx.name, isAdmin })
          }
        >
          <SettingsOutlined size="xxx-small" />
          Workspace settings
          {isAdmin && hasPendingRequests && (
            <span className="ml-auto">
              <Badge
                dsVersion="2.0"
                type="numeric"
                variant="notifications"
                size="xxx-small"
                value={requests.length}
              />
            </span>
          )}
        </button>
        <button
          type="button"
          className={cn(sidebarRow.base, sidebarRow.default)}
          onClick={() => leave.mutate()}
        >
          <ChevronLeftOutlined size="xxx-small" />
          {isAdmin ? 'All workspaces' : 'Launcher'}
        </button>
      </div>

      {!collapsed && (
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
        >
          <span className={cn(styles.resizeBar, isResizing && styles.resizeBarActive)} />
          <span className={cn(styles.resizeKnob, isResizing && styles.resizeKnobActive)}>
            <DotsSixVerticalOutlined variant="subtle" size="xxx-small" />
          </span>
        </div>
      )}
    </aside>
  );
}
