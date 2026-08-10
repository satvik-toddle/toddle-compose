import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { PageLoader } from '../components/Loader';

// '/' → launcher (authed) or login (anon). The launcher itself renders the
// zero-workspaces empty states.
export function RootRedirect() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') {
    return (
      <div className="rbac">
        <PageLoader />
      </div>
    );
  }
  return <Navigate to={status === 'authed' ? '/launcher' : '/login'} replace />;
}
