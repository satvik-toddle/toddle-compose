import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { RoleSelect } from '../../components/RoleSelect';
import { PageLoader } from '../../components/Loader';
import { useRealmJoinRequests } from '../../hooks/queries';
import { useApproveRequest, useRejectRequest } from '../../hooks/useJoinRequestMutations';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/cn';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

const REQ_GRID = 'grid-cols-[1.6fr_1fr_150px_120px_200px]';

const styles = {
  page: 'flex-1 overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto max-w-[1040px]',
  pageHead: 'mb-5 flex items-end justify-between gap-[18px]',
  h1: 'm-0 text-[25px] font-extrabold tracking-[-0.01em]',
  headSub: 'mt-1 text-[13px] text-secondary',
  emptyWrap: 'py-8 text-center',
  emptyTitle: 'text-[15px] font-semibold',
  emptyText: 'mt-1 text-[13px] text-secondary',
  table: 'overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--panel-bg)]',
  thead: cn('grid items-center border-b border-[var(--line)] bg-surface-secondary-enabled', REQ_GRID),
  th: 'px-4 py-[11px] text-[11px] font-bold uppercase tracking-[0.04em] text-secondary',
  trow: cn(
    'grid items-center border-b border-[var(--line)] last:border-b-0 hover:bg-surface-secondary-enabled',
    REQ_GRID,
  ),
  td: 'px-4 py-[13px] text-[13px]',
  tdMuted: 'px-4 py-[13px] text-[12px] text-secondary',
  tdActions: 'flex justify-end gap-[7px] px-4 py-[13px]',
  cellRight: 'text-right',
  cellMain: 'flex items-center gap-2.75',
  nm: 'text-[13px] font-semibold',
  rowSub: 'mt-px text-[12px] text-secondary',
  wsPill: 'inline-flex items-center gap-2 text-[13px] font-semibold',
  wsEmoji: 'flex h-6 w-6 min-w-[24px] items-center justify-center rounded-2.5',
};

export function JoinRequestsTab() {
  const { data: requests, isLoading } = useRealmJoinRequests();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  // Per-request grant role (defaults to what they requested).
  const [grant, setGrant] = useState<Record<string, WorkspaceRole>>({});

  if (isLoading)
    return (
      <div className={styles.page}>
        <div className={styles.pageWrap}>
          <PageLoader />
        </div>
      </div>
    );
  const list = requests ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.pageWrap}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.h1}>Join requests</h1>
            <div className={styles.headSub}>
              People asking to join private workspaces across the realm. Approve to add them with a role.
            </div>
          </div>
        </div>

        {list.length === 0 ? (
          <div className={styles.emptyWrap}>
            <div className={styles.emptyTitle}>No pending requests</div>
            <div className={styles.emptyText}>
              When someone asks to join a private workspace, it'll show up here.
            </div>
          </div>
        ) : (
          <div className={styles.table}>
            <div className={styles.thead}>
              <div className={styles.th}>Person</div>
              <div className={styles.th}>Workspace</div>
              <div className={styles.th}>Wants</div>
              <div className={styles.th}>Requested</div>
              <div className={cn(styles.th, styles.cellRight)}>Decision</div>
            </div>
            {list.map((r) => {
              const role = grant[r.id] ?? r.requestedRole;
              const vis = workspaceVisual(r.workspaceId);
              return (
                <div key={r.id} className={styles.trow}>
                  <div className={cn(styles.td, styles.cellMain)}>
                    <Avatar person={{ name: r.user.name, color: r.user.color }} size={32} />
                    <div>
                      <div className={styles.nm}>{r.user.name}</div>
                      <div className={styles.rowSub}>{r.user.email}</div>
                    </div>
                  </div>
                  <div className={styles.td}>
                    <span className={styles.wsPill}>
                      <span
                        className={styles.wsEmoji}
                        style={{
                          background: vis.color + '22',
                          boxShadow: `inset 0 0 0 1px ${vis.color}44`,
                        }}
                      >
                        <Icon name={vis.icon} size={14} style={{ color: vis.color }} />
                      </span>
                      {r.workspace?.name ?? 'Workspace'}
                    </span>
                  </div>
                  <div className={styles.td}>
                    <RoleSelect<WorkspaceRole>
                      value={role}
                      options={ROLE_OPTIONS}
                      onChange={(v) => setGrant((g) => ({ ...g, [r.id]: v }))}
                      renderValue={(v) => <WSChip role={v} />}
                    />
                  </div>
                  <div className={styles.tdMuted}>{relativeTime(r.createdAt)}</div>
                  <div className={styles.tdActions}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="TickSmallOutlined"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate({ workspaceId: r.workspaceId, requestId: r.id, role })}
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
