import { RequestsTable } from '../../components/RequestsTable';
import { useRealmJoinRequests } from '../../hooks/queries';

const styles = {
  page: 'flex-1 overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto max-w-[1040px]',
  pageHead: 'mb-5 flex items-end justify-between gap-[18px]',
  h1: 'm-0 text-[25px] font-extrabold tracking-[-0.01em]',
  headSub: 'mt-1 text-[13px] text-secondary',
};

export function JoinRequestsTab() {
  const { data: requests, isLoading } = useRealmJoinRequests();

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
        <RequestsTable
          requests={requests ?? []}
          isLoading={isLoading}
          showWorkspace
        />
      </div>
    </div>
  );
}
