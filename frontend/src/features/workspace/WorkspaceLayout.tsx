import { useEffect, useRef, useState } from 'react';
import { Outlet, useOutletContext, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { WSChip } from '../../components/WSChip';
import { AcctPill } from '../../components/AcctPill';
import { PageSpinner } from '../../components/Spinner';
import { WsNav } from './WsNav';
import { useRealm, useWorkspace, useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../hooks/useAuthMutations';
import { useAuthStore } from '../../stores/authStore';
import { effectiveWorkspaceRole, isRealmAdmin } from '../../lib/roles';
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const vis = workspaceVisual(ctx.workspaceId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!me) return null;
  return (
    <div className="ws-topbar">
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
      <div className="ws-tb-right">
        {ctx.overlay ? <WSChip overlay /> : <WSChip role={ctx.role} />}
        <IconButton icon="SearchOutlined" iconSize={18} />
        <IconButton icon="BellRingOutlined" iconSize={18} />
        <Button icon="ShareOutlined" size="sm">
          Share
        </Button>
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
