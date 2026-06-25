import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '@toddle-edu/ds-web';
import { AppBar } from '../../components/AppBar';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useRealm, useRealmJoinRequests, useRealmMembers, useWorkspaces } from '../../hooks/queries';
import { useAuthStore } from '../../stores/authStore';
import s from './AdminConsolePage.module.scss';

function Count({ n, alert }: { n?: number; alert?: boolean }) {
  if (n == null) return null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '0 6px',
        height: 16,
        lineHeight: '16px',
        borderRadius: 999,
        background: alert && n > 0 ? 'var(--red-500)' : 'var(--surface-tertiary-enabled)',
        color: alert && n > 0 ? '#fff' : 'var(--text-secondary)',
      }}
    >
      {n}
    </span>
  );
}

export function AdminConsolePage() {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const { data: workspaces } = useWorkspaces();
  const { data: members } = useRealmMembers();
  const { data: requests } = useRealmJoinRequests();
  const navigate = useNavigate();
  const loc = useLocation();
  if (!me) return null;

  const active = loc.pathname.includes('/members')
    ? 'members'
    : loc.pathname.includes('/requests')
      ? 'requests'
      : loc.pathname.includes('/settings')
        ? 'settings'
        : 'workspaces';

  const options = [
    { value: 'workspaces', label: 'Workspaces', suffix: <Count n={workspaces?.length} /> },
    { value: 'members', label: 'Realm members', suffix: <Count n={members?.length} /> },
    { value: 'requests', label: 'Join requests', suffix: <Count n={requests?.length} alert /> },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <div className="rbac">
      <AppBar realm={realm?.name ?? 'Toddle'} sub="Realm" me={me} realmRole={realm?.role} />
      <div className={s.adSubbar}>
        <div className={s.adTitle}>
          <Icon name="DashboardOutlined" size={18} muted />
          Admin console
        </div>
        <div className={s.adCrumb}>{realm?.name ?? 'Toddle'} realm</div>
        <Button
          size="sm"
          variant="ghost"
          icon="ChevronLeftOutlined"
          style={{ marginLeft: 'auto' }}
          onClick={() => navigate('/launcher')}
        >
          Back to workspaces
        </Button>
      </div>
      <div style={{ padding: '0 22px', background: 'var(--panel-bg)', borderBottom: '1px solid var(--line)' }}>
        <Tabs options={options} value={active} onChange={(v: string) => navigate(`/admin/${v}`)} variant="inline" />
      </div>
      <Outlet />
    </div>
  );
}
