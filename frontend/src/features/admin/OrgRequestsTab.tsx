import { OrgRequestsTable } from '../../components/OrgRequestsTable';
import { useRealmOrgRequests } from '../../hooks/queries';
import { adminTabStyles as styles } from './adminTabStyles';

export function OrgRequestsTab() {
  const { data: requests, isLoading } = useRealmOrgRequests();

  return (
    <div className={styles.page}>
      <div className={styles.pageWrap}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.h1}>Org requests</h1>
            <div className={styles.headSub}>
              People asking to join this organisation. Approve to add them as a member.
            </div>
          </div>
        </div>
        <OrgRequestsTable requests={requests ?? []} isLoading={isLoading} />
      </div>
    </div>
  );
}
