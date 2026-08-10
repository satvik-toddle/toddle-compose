import { useNavigate } from 'react-router-dom';
import { AppBar } from '../../components/AppBar';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../stores/authStore';
import { useRealm } from '../../hooks/queries';

export function NoAccessPanel({
  title = "You don't have access to this",
  message = "This workspace is private, or your role doesn't include it. If you think this is a mistake, ask a realm admin to add you.",
}: {
  title?: string;
  message?: string;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <div className="rbac">
      <AppBar realm={realm?.name ?? 'Toddle'} sub="Realm" me={me} realmRole={realm?.role} />
      <div className="page" style={{ display: 'flex', alignItems: 'center' }}>
        <div className="page-wrap">
          <EmptyState
            title={title}
            actions={
              <Button variant="primary" icon="ChevronLeftOutlined" onClick={() => navigate('/launcher')}>
                Back to workspaces
              </Button>
            }
          >
            {message}
          </EmptyState>
        </div>
      </div>
    </div>
  );
}
