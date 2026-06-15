import { useState } from 'react';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { Icon } from '../../components/Icon';
import { RoleSelect } from '../../components/RoleSelect';
import { EmptyState } from '../../components/EmptyState';
import { PageSpinner } from '../../components/Spinner';
import { useWorkspaceJoinRequests } from '../../hooks/queries';
import { useApproveRequest, useRejectRequest } from '../../hooks/useJoinRequestMutations';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { useWorkspaceCtx } from './WorkspaceLayout';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

export function RequestsPanel() {
  const ctx = useWorkspaceCtx();
  const { data: requests, isLoading } = useWorkspaceJoinRequests(ctx.workspaceId, ctx.isAdmin);
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [grant, setGrant] = useState<Record<string, WorkspaceRole>>({});

  if (!ctx.isAdmin) {
    return (
      <main className="ws-main">
        <div className="ws-crumbbar">
          <div className="ws-crumbs">
            <span>{ctx.name}</span>
            <span className="sep">/</span>
            <span className="cur">📥 Requests</span>
          </div>
          <span className="lock-note">
            <Icon name="LockOutlined" size={14} />
            Only admins see this
          </span>
        </div>
      </main>
    );
  }

  const list = requests ?? [];

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span>{ctx.name}</span>
          <span className="sep">/</span>
          <span className="cur">📥 Requests</span>
        </div>
        <span className="lock-note">
          <Icon name="LockOutlined" size={14} />
          Only admins see this
        </span>
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>
            📥
          </span>
          <div>
            <h1>Join requests</h1>
            <div className="sub">
              {list.length} {list.length === 1 ? 'person wants' : 'people want'} to join {ctx.name} ·
              approve to add them with a role
            </div>
          </div>
        </div>

        {isLoading ? (
          <PageSpinner />
        ) : list.length === 0 ? (
          <EmptyState glyph="🎉" glyphStyle={{ background: 'var(--surface-secondary-enabled)' }} title="No pending requests">
            When someone asks to join {ctx.name}, it'll show up here.
          </EmptyState>
        ) : (
          <div className="tbl ws-req-tbl">
            <div className="thead">
              <div>Person</div>
              <div>Grant role</div>
              <div>Requested</div>
              <div style={{ textAlign: 'right' }}>Decision</div>
            </div>
            {list.map((r) => {
              const role = grant[r.id] ?? r.requestedRole;
              return (
                <div key={r.id} className="trow">
                  <div className="cell-main">
                    <Avatar person={{ name: r.user.name, color: r.user.color }} size={32} />
                    <div>
                      <div className="nm">{r.user.name}</div>
                      <div className="sub">{r.user.email}</div>
                    </div>
                  </div>
                  <div>
                    <RoleSelect<WorkspaceRole>
                      value={role}
                      options={ROLE_OPTIONS}
                      onChange={(v) => setGrant((g) => ({ ...g, [r.id]: v }))}
                      renderValue={(v) => <WSChip role={v} />}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {relativeTime(r.createdAt)}
                  </div>
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="TickSmallOutlined"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate({ workspaceId: ctx.workspaceId, requestId: r.id, role })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate({ workspaceId: ctx.workspaceId, requestId: r.id })}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
