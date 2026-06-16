import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { WSChip } from '../../components/WSChip';
import { AcctPill } from '../../components/AcctPill';
import { PageSpinner } from '../../components/Spinner';
import { WsNav } from './WsNav';
import { useRealm, useWorkspace, useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { useCreateDocument, useDocuments } from '../../hooks/usePages';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { effectiveWorkspaceRole, isRealmAdmin, wsAtLeast } from '../../lib/roles';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { cn } from '../../lib/cn';
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

function WorkspaceSwitcher({ currentId, onClose }: { currentId: string; onClose: () => void }) {
  const { data: workspaces = [] } = useWorkspaces();
  const { data: realm } = useRealm();
  const enter = useEnterWorkspace();
  const leave = useLeaveWorkspace();
  const admin = isRealmAdmin(realm?.role);

  return (
    <div className="ws-switch-menu">
      <div className="sm-label">Switch workspace</div>
      {workspaces.map((w) => {
        const vis = workspaceVisual(w.id);
        const on = w.id === currentId;
        return (
          <div
            key={w.id}
            className={cn('sm-row', on && 'on')}
            role="button"
            onClick={() => {
              if (!on) enter.mutate(w.id);
              onClose();
            }}
          >
            <span
              className="ws-emoji sm"
              style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
            >
              <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
            </span>
            <span className="nm">{w.name}</span>
            {on && (
              <Icon name="TickSmallOutlined" size={14} style={{ marginLeft: 'auto', color: 'var(--interactive-primary)' }} />
            )}
          </div>
        );
      })}
      <div className="sm-div" />
      <div
        className="sm-row foot"
        role="button"
        onClick={() => {
          leave.mutate();
          onClose();
        }}
      >
        <Icon name="ChevronLeftOutlined" size={14} muted />
        {admin ? 'Back to all workspaces' : 'Workspace launcher'}
      </div>
    </div>
  );
}

function WsTopbar({ ctx }: { ctx: WorkspaceCtx }) {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);
  const createDoc = useCreateDocument();
  const openModal = useUiStore((s) => s.openModal);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const vis = workspaceVisual(ctx.workspaceId);

  useEffect(() => {
    if (!open && !menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, menuOpen]);

  if (!me) return null;

  // Single toolbar: the workspace switcher + (when a page is open) a breadcrumb on
  // the left, and the page's contextual actions on the right. There is no second
  // (per-page) toolbar — this owns the doc title, Share, and the ⋯ page menu.
  const ws = ctx.workspaceId;
  const docId = params.get('doc');
  const doc = docId ? docs.find((d) => d.id === docId) : undefined;
  const canCreate = wsAtLeast(ctx.role, 'EDIT');
  const canManage = !!doc && (ctx.isAdmin || doc.owner.id === me.id);

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
    <div className="ws-topbar">
      <div className="ws-tb-left">
        <div className="ws-switch-wrap" ref={ref}>
          <button className={cn('ws-switch', open && 'open')} onClick={() => setOpen((v) => !v)}>
            <span
              className="ws-emoji sm"
              style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
            >
              <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
            </span>
            <span className="nm">{ctx.name}</span>
            <Icon name="ChevronDownOutlined" size={14} muted />
          </button>
          {open && <WorkspaceSwitcher currentId={ctx.workspaceId} onClose={() => setOpen(false)} />}
        </div>
        {doc && (
          <div className="ws-crumb">
            <span className="ws-crumb-sep">/</span>
            <Icon name="FileOutlined" size={16} muted />
            <span className="ws-crumb-title">{doc.title}</span>
          </div>
        )}
      </div>
      <div className="ws-tb-right">
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
              <div className="ws-switch-wrap" ref={menuRef}>
                <IconButton icon="DotsHorizontalOutlined" iconSize={18} onClick={() => setMenuOpen((v) => !v)} />
                {menuOpen && (
                  <div className="folder-menu">
                    {canCreate && (
                      <div
                        className="fm-row"
                        role="button"
                        onClick={() => {
                          setMenuOpen(false);
                          addSubPage();
                        }}
                      >
                        <Icon name="AddOutlined" size={14} muted />
                        Add sub-page
                      </div>
                    )}
                    {canManage && (
                      <div
                        className="fm-row"
                        role="button"
                        onClick={() => {
                          setMenuOpen(false);
                          openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title });
                        }}
                      >
                        <Icon name="PencilOutlined" size={14} muted />
                        Rename
                      </div>
                    )}
                    {canManage && (
                      <>
                        <div className="fm-div" />
                        <div
                          className="fm-row danger"
                          role="button"
                          onClick={() => {
                            setMenuOpen(false);
                            openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title });
                          }}
                        >
                          <Icon name="DeleteOutlined" size={14} red />
                          Delete
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
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

  if (isLoading || !ws || !workspaceId) {
    return (
      <div className="rbac">
        <PageSpinner />
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
      <WsTopbar ctx={ctx} />
      <div className="ws-body">
        <WsNav ctx={ctx} />
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
