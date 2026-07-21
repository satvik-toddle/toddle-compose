import { Outlet } from 'react-router-dom';
import { useRealm } from '../hooks/queries';
import { isRealmAdmin, isUserMember } from '../lib/roles';
import { Loader } from '../components/Loader';
import { OrgJoinGate } from '../features/auth/OrgJoinGate';

// Holds a signed-in non-member at the request/pending gate when the realm has
// join-requests enabled; otherwise (or for members/admins) renders the app.
export function MembershipGate() {
  const { data: realm, isLoading } = useRealm();
  if (isLoading) {
    // Self-contained loader: the raw <Loader/> centred with Tailwind, so this
    // gate doesn't depend on the `.rbac` scope (which is what scopes PageLoader's
    // `.rbac .tc-center` centring). --app-bg lives at :root, so it resolves here.
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--app-bg)]">
        <Loader />
      </div>
    );
  }
  const inOrg = isUserMember(realm?.role) || isRealmAdmin(realm?.role);
  if (!inOrg && realm?.joinRequestsEnabled) return <OrgJoinGate />;
  return <Outlet />;
}
