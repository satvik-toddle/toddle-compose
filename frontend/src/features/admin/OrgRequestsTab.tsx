import { OrgRequestsTable } from '../../components/OrgRequestsTable';
import { useRealmOrgRequests } from '../../hooks/queries';

const styles = {
  page: 'flex flex-1 flex-col overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto flex w-full max-w-[1040px] flex-1 flex-col',
  pageHead: 'mb-5 flex items-end justify-between gap-[18px]',
  h1: 'm-0 text-[25px] font-extrabold tracking-[-0.01em]',
  headSub: 'mt-1 text-[13px] text-secondary',
};

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
