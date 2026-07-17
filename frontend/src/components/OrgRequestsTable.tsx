import { Button } from './Button';
import { PersonCell } from './PersonCell';
import { PageLoader } from './Loader';
import { EmptyState } from './EmptyState';
import { useApproveOrgRequest, useRejectOrgRequest } from '../hooks/useOrgJoinRequestMutations';
import { relativeTime } from '../lib/time';
import { cn } from '../lib/cn';
import { tableStyles as t } from './tableStyles';
import type { OrgJoinRequest } from '../types/api';

const styles = {
  emptyWrap: 'flex flex-1 items-center justify-center',
};

// Pending org-join requests. Approval always grants realm MEMBER, so there's no
// workspace column or role select — just who asked, when, and a decision.
export function OrgRequestsTable({
  requests,
  isLoading,
  emptyText,
}: {
  requests: OrgJoinRequest[];
  isLoading?: boolean;
  emptyText?: string;
}) {
  const approve = useApproveOrgRequest();
  const reject = useRejectOrgRequest();

  if (isLoading) return <PageLoader />;
  if (requests.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState title="No pending requests">{emptyText}</EmptyState>
      </div>
    );
  }

  const cols = 'grid-cols-[minmax(0,1fr)_160px_auto]';

  return (
    <div className={t.table}>
      <div className={cn(t.thead, cols)}>
        <div className={t.th}>Person</div>
        <div className={t.th}>Requested</div>
        <div className={cn(t.th, t.cellRight)}>Decision</div>
      </div>
      {requests.map((r) => (
        <div key={r.id} className={cn(t.trow, cols)}>
          <div className={t.td}>
            <PersonCell name={r.user.name} email={r.user.email} color={r.user.color} />
          </div>
          <div className={t.tdMuted}>{relativeTime(r.createdAt)}</div>
          <div className={t.tdActions}>
            <Button
              variant="primary"
              size="sm"
              icon="TickSmallOutlined"
              disabled={approve.isPending}
              onClick={() => approve.mutate(r.id)}
            >
              Approve
            </Button>
            <Button size="sm" disabled={reject.isPending} onClick={() => reject.mutate(r.id)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
