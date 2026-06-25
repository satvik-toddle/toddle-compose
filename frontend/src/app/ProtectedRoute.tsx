import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { PageLoader } from '../components/Loader';

export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  return <Outlet />;
}
