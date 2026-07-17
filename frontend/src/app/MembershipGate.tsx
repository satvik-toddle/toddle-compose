import { Outlet } from 'react-router-dom';
import { useRealm } from '../hooks/queries';
import { isRealmAdmin, isUserMember } from '../lib/roles';
import { PageLoader } from '../components/Loader';
import { OrgJoinGate } from '../features/auth/OrgJoinGate';

// Holds a signed-in non-member at the request/pending gate when the realm has
// join-requests enabled; otherwise (or for members/admins) renders the app.
export function MembershipGate() {
  const { data: realm, isLoading } = useRealm();
  if (isLoading) {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }
  const inOrg = isUserMember(realm?.role) || isRealmAdmin(realm?.role);
  if (!inOrg && realm?.joinRequestsEnabled) return <OrgJoinGate />;
  return <Outlet />;
}
