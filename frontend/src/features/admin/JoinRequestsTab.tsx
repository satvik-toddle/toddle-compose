import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { RoleSelect } from '../../components/RoleSelect';
import { EmptyState } from '../../components/EmptyState';
import { PageSpinner } from '../../components/Spinner';
import s from './JoinRequestsTab.module.scss';
import { useRealmJoinRequests } from '../../hooks/queries';
import { useApproveRequest, useRejectRequest } from '../../hooks/useJoinRequestMutations';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

export function JoinRequestsTab() {
  const { data: requests, isLoading } = useRealmJoinRequests();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  // Per-request grant role (defaults to what they requested).
  const [grant, setGrant] = useState<Record<string, WorkspaceRole>>({});

  if (isLoading) return <div className="page"><div className="page-wrap"><PageSpinner /></div></div>;
  const list = requests ?? [];

  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Join requests</h1>
            <div className="sub">
              People asking to join private workspaces across the realm. Approve to add them with a
              role.
            </div>
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState
            glyph="🎉"
            glyphStyle={{ background: 'var(--surface-secondary-enabled)' }}
            title="No pending requests"
          >
            When someone asks to join a private workspace, it'll show up here.
          </EmptyState>
        ) : (
          <div className={`tbl ${s.adReqTbl}`}>
            <div className="thead">
              <div>Person</div>
              <div>Workspace</div>
              <div>Wants</div>
              <div>Requested</div>
              <div style={{ textAlign: 'right' }}>Decision</div>
            </div>
            {list.map((r) => {
              const role = grant[r.id] ?? r.requestedRole;
              const vis = workspaceVisual(r.workspaceId);
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
                    <span className={s.wsPill}>
                      <span
                        className="ws-emoji sm"
                        style={{
                          width: 24,
                          height: 24,
                          fontSize: 14,
                          background: vis.color + '22',
                          boxShadow: `inset 0 0 0 1px ${vis.color}44`,
                        }}
                      >
                        <Icon name={vis.icon} size={14} style={{ color: vis.color }} />
                      </span>
                      {r.workspace?.name ?? 'Workspace'}
                    </span>
                  </div>
                  <div>
                    <RoleSelect<WorkspaceRole>
                      value={role}
                      options={ROLE_OPTIONS}
                      onChange={(v) => setGrant((g) => ({ ...g, [r.id]: v }))}
                      renderValue={(v) => <WSChip role={v} />}
                    />
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {relativeTime(r.createdAt)}
                  </div>
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="TickSmallOutlined"
                      disabled={approve.isPending}
                      onClick={() =>
                        approve.mutate({ workspaceId: r.workspaceId, requestId: r.id, role })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate({ workspaceId: r.workspaceId, requestId: r.id })}
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
    </div>
  );
}
