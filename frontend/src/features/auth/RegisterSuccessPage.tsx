import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthShell } from './AuthShell';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useAuthStore } from '../../stores/authStore';
import { performLogout } from '../../lib/session';
import { firstName } from '../../lib/time';

export function RegisterSuccessPage() {
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await performLogout(qc);
    navigate('/login');
  };

  return (
    <AuthShell
      foot={
        <span>
          Wrong account?{' '}
          <a onClick={signOut} role="button">
            Sign out
          </a>
        </span>
      }
    >
      <div className="auth-success">
        <div className="suc-glyph">
          <Icon name="TickCircleOutlined" size={24} />
        </div>
        <h1 className="auth-h" style={{ marginTop: 4 }}>
          You're all set{me ? `, ${firstName(me.name)}` : ''}
        </h1>
        <p className="auth-p" style={{ maxWidth: 360 }}>
          Your account is created. An <b>admin needs to add you to a workspace</b> before you can
          start — or find one to join below.
        </p>
        <div className="suc-wait">
          <span className="pulse" />
          Waiting to be added to a workspace
        </div>
        <Button
          variant="primary"
          className="block"
          icon="SearchOutlined"
          style={{ marginTop: 6 }}
          onClick={() => navigate('/access')}
        >
          Find a workspace to join
        </Button>
        {me && <p className="auth-fine">Signed in as <b>{me.email}</b></p>}
      </div>
    </AuthShell>
  );
}
