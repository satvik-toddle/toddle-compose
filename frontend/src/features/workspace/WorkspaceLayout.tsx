import { useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { ActionMenu, type MenuItem } from '../../components/ActionMenu';
import { WSChip } from '../../components/WSChip';
import { AcctPill } from '../../components/AcctPill';
import { PageLoader } from '../../components/Loader';
import { WorkspaceSidebar } from './sidebar';
import s from './WorkspaceLayout.module.scss';
import { useRealm, useWorkspace, useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { useCreateDocument, useDocuments } from '../../hooks/usePages';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { effectiveWorkspaceRole, isRealmAdmin, wsAtLeast } from '../../lib/roles';
import { workspaceVisual } from '../../lib/workspaceVisual';
import type { WorkspaceRole, RealmRole } from '../../types/roles';

export interface WorkspaceCtx {
  workspaceId: string;
  name: string;
  role: WorkspaceRole; // effective role (incl. overlay)
  isAdmin: boolean;
  overlay: boolean;
  realmRole: RealmRole | null;
}

export function useWorkspaceCtx() {
  return useOutletContext<WorkspaceCtx>();
}

// Coda / VS Code-style "panel-left" sidebar-toggle glyph (a rounded panel with a
// divider marking the side rail) — ds-icons has no sidebar/panel icon.
function SidebarToggleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

function WsTopbar({ ctx, onToggleSidebar }: { ctx: WorkspaceCtx; onToggleSidebar: () => void }) {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);
  const { data: workspaces = [] } = useWorkspaces();
  const enter = useEnterWorkspace();
  const leave = useLeaveWorkspace();
  const createDoc = useCreateDocument();
  const openModal = useUiStore((s) => s.openModal);
  const vis = workspaceVisual(ctx.workspaceId);

  if (!me) return null;

  // Single toolbar: the workspace switcher + (when a page is open) a breadcrumb on
  // the left, and the page's contextual actions on the right. There is no second
  // (per-page) toolbar — this owns the doc title, Share, and the ⋯ page menu.
  const ws = ctx.workspaceId;
  const docId = params.get('doc');
  const doc = docId ? docs.find((d) => d.id === docId) : undefined;
  const canCreate = wsAtLeast(ctx.role, 'EDIT');
  const canManage = !!doc && (ctx.isAdmin || doc.owner.id === me.id);

  // Workspace switcher entries: each workspace (tick on the current one) + a
  // "back to launcher" footer.
  const switcherItems: MenuItem[] = [
    ...workspaces.map((w) => {
      const wv = workspaceVisual(w.id);
      return {
        key: w.id,
        label: w.name,
        icon: wv.icon,
        iconColor: wv.color,
        onSelect: () => {
          if (w.id !== ctx.workspaceId) enter.mutate(w.id);
        },
      };
    }),
    {
      key: '__leave',
      label: isRealmAdmin(realm?.role) ? 'Back to all workspaces' : 'Workspace launcher',
      icon: 'ChevronLeftOutlined',
      dividerBefore: true,
      onSelect: () => leave.mutate(),
    },
  ];

  const newPage = () =>
    createDoc.mutate({ workspaceId: ws, title: 'Untitled' }, { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) });
  const addSubPage = () => {
    if (!doc) return;
    createDoc.mutate(
      { workspaceId: ws, parentId: doc.id, title: 'Untitled' },
      { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) },
    );
  };

  return (
    <div className={s.wsTopbar}>
      <div className={s.wsTbLeft}>
        <button
          className={`ibtn ${s.tbSidebarToggle}`}
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <SidebarToggleIcon />
        </button>
        <ActionMenu
          placement="bottomLeft"
          header="Switch workspace"
          selectedKey={ctx.workspaceId}
          items={switcherItems}
          trigger={
            <button className={s.wsSwitch}>
              <span
                className="ws-emoji sm"
                style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
              >
                <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
              </span>
              <span className="nm">{ctx.name}</span>
              <Icon name="ChevronDownOutlined" size={14} muted />
            </button>
          }
        />
        {doc && (
          <div className={s.wsCrumb}>
            <span className={s.wsCrumbSep}>/</span>
            <Icon name="FileOutlined" size={16} muted />
            <span className={s.wsCrumbTitle}>{doc.title}</span>
          </div>
        )}
      </div>
      <div className={s.wsTbRight}>
        {ctx.overlay ? <WSChip overlay /> : <WSChip role={ctx.role} />}
        <IconButton icon="SearchOutlined" iconSize={18} />
        <IconButton icon="BellRingOutlined" iconSize={18} />
        {doc ? (
          <>
            <Button
              icon="ShareOutlined"
              size="sm"
              onClick={() =>
                openModal({
                  type: 'shareDocument',
                  workspaceId: ws,
                  docId: doc.id,
                  docTitle: doc.title,
                  canManage,
                  isAdmin: ctx.isAdmin,
                })
              }
            >
              Share
            </Button>
            {(canCreate || canManage) && (
              <ActionMenu
                placement="bottomRight"
                trigger={<IconButton icon="DotsHorizontalOutlined" iconSize={18} />}
                items={[
                  ...(canCreate
                    ? [{ key: 'subpage', label: 'Add sub-page', icon: 'AddOutlined' as const, onSelect: addSubPage }]
                    : []),
                  ...(canManage
                    ? [
                        {
                          key: 'rename',
                          label: 'Rename',
                          icon: 'PencilOutlined' as const,
                          onSelect: () =>
                            openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title }),
                        },
                        {
                          key: 'delete',
                          label: 'Delete',
                          icon: 'DeleteOutlined' as const,
                          danger: true,
                          dividerBefore: true,
                          onSelect: () =>
                            openModal({
                              type: 'confirmDeletePage',
                              kind: 'doc',
                              workspaceId: ws,
                              id: doc.id,
                              name: doc.title,
                            }),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </>
        ) : (
          canCreate && (
            <Button variant="primary" icon="AddOutlined" size="sm" onClick={newPage} disabled={createDoc.isPending}>
              New page
            </Button>
          )
        )}
        <AcctPill me={me} realmRole={realm?.role} compact />
      </div>
    </div>
  );
}

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: ws, isLoading } = useWorkspace(workspaceId);
  const { data: realm } = useRealm();
  // Live sidebar: refetch the doc list when another member changes a doc.
  useWorkspaceEvents(workspaceId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('tc-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('tc-sidebar', next ? 'collapsed' : 'open');
      } catch {
        /* ignore */
      }
      return next;
    });

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
      <WsTopbar ctx={ctx} onToggleSidebar={toggleSidebar} />
      <div className={s.wsBody}>
        <WorkspaceSidebar ctx={ctx} collapsed={sidebarCollapsed} />
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
