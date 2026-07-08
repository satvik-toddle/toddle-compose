import { useState } from 'react';
import { Button } from './Button';
import { WSChip } from './WSChip';
import { RoleSelect } from './RoleSelect';
import { PageLoader } from './Loader';
import { PersonCell } from './PersonCell';
import { WorkspaceBadge } from './WorkspaceBadge';
import { EmptyState } from './EmptyState';
import { useApproveRequest, useRejectRequest } from '../hooks/useJoinRequestMutations';
import { WS_ROLE_OPTIONS } from '../lib/roles';
import { relativeTime } from '../lib/time';
import { cn } from '../lib/cn';
import { tableStyles as t } from './tableStyles';
import type { JoinRequest } from '../types/api';
import type { WorkspaceRole } from '../types/roles';

// Pending join-requests table shared by the workspace-settings modal (single
// workspace) and the admin console (realm-wide, with a Workspace column).
export function RequestsTable({
  requests,
  isLoading,
  emptyText,
  showWorkspace = false,
}: {
  requests: JoinRequest[];
  isLoading?: boolean;
  emptyText?: string;
  showWorkspace?: boolean;
}) {
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [grant, setGrant] = useState<Record<string, WorkspaceRole>>({});

  if (isLoading) return <PageLoader />;
  if (requests.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState title="No pending requests">
          {emptyText}
        </EmptyState>
      </div>
    );
  }

  // Decision column is `auto` so it always fits the Approve/Decline buttons; the
  // flexible columns use minmax(0,…) so they shrink (truncate) instead of pushing
  // the buttons past the edge. The realm-wide view has extra room for Workspace +
  // Requested columns; the narrow modal drops them (matches the 4b reference).
  const cols = showWorkspace
    ? 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_150px_120px_auto]'
    : 'grid-cols-[minmax(0,1fr)_160px_auto]';

  return (
    <div className={t.table}>
      <div className={cn(t.thead, cols)}>
        <div className={t.th}>Person</div>
        {showWorkspace && <div className={t.th}>Workspace</div>}
        <div className={t.th}>Grant role</div>
        {showWorkspace && <div className={t.th}>Requested</div>}
        <div className={cn(t.th, t.cellRight)}>Decision</div>
      </div>
      {requests.map((r) => {
        const role = grant[r.id] ?? r.requestedRole;
        return (
          <div key={r.id} className={cn(t.trow, cols)}>
            <div className={t.td}>
              <PersonCell name={r.user.name} email={r.user.email} color={r.user.color} />
            </div>
            {showWorkspace && (
              <div className={t.td}>
                <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                  <WorkspaceBadge id={r.workspaceId} size={24} iconSize={14} />
                  <span className="truncate">{r.workspace?.name ?? 'Workspace'}</span>
                </span>
              </div>
            )}
            <div className={t.td}>
              <RoleSelect<WorkspaceRole>
                value={role}
                options={WS_ROLE_OPTIONS}
                onChange={(v) => setGrant((g) => ({ ...g, [r.id]: v }))}
                renderValue={(v) => <WSChip role={v} />}
              />
            </div>
            {showWorkspace && <div className={t.tdMuted}>{relativeTime(r.createdAt)}</div>}
            <div className={t.tdActions}>
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
  );
}
