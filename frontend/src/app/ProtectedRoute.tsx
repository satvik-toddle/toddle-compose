import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { PageLoader } from '../components/Loader';

export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }
  // Carry the intended destination (e.g. a share-email deep link) so LoginPage can return here after sign-in.
  if (status === 'anon')
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}
