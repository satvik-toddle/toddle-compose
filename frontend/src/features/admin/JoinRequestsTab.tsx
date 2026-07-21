import { RequestsTable } from '../../components/RequestsTable';
import { useRealmJoinRequests } from '../../hooks/queries';
import { adminTabStyles as styles } from './adminTabStyles';

export function JoinRequestsTab() {
  const { data: requests, isLoading } = useRealmJoinRequests();

  return (
    <div className={styles.page}>
      <div className={styles.pageWrap}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.h1}>Workspace requests</h1>
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
