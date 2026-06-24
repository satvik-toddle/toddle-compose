import { Outlet } from 'react-router-dom';
import { useRealm } from '../hooks/queries';
import { isRealmAdmin } from '../lib/roles';
import { PageLoader } from '../components/Loader';
import { NoAccessPanel } from '../features/errors/NoAccessPanel';

// Gates /admin/* to realm OWNER/MAINTAINER. Renders the 403 panel (keeps the
// chrome) rather than redirecting.
export function RequireRealmAdmin() {
  const { data: realm, isLoading } = useRealm();
  if (isLoading) {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }
  if (!isRealmAdmin(realm?.role)) {
    return (
      <NoAccessPanel
        title="The admin console is for realm admins"
        message="Only the realm owner and maintainers can manage workspaces and members."
      />
    );
  }
  return <Outlet />;
}
