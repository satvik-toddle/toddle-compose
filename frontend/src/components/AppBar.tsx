import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';

// Post-login top bar: brand + realm name, optional left/right slots, account pill.
// The brand doubles as a "home" link back to the launcher.
export function AppBar({
  realm = 'Toddle',
  sub = 'Realm',
  me,
  realmRole,
  left,
  right,
}: {
  realm?: string;
  sub?: string;
  me: User;
  realmRole?: RealmRole | null;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const goHome = () => navigate('/launcher');
  return (
    <div className="appbar">
      <div
        className="brand"
        role="link"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        title="Back to workspaces"
        onClick={goHome}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            goHome();
          }
        }}
      >
        <div className="logo">
          <img src="/brand/ToddleLogo.svg" alt="Toddle" />
        </div>
        <div className="realm">
          <div className="nm">{realm}</div>
          <div className="sub">{sub}</div>
        </div>
      </div>
      {left}
      <div className="gap" />
      {right}
      <AccountMenu user={me} realmRole={realmRole} />
    </div>
  );
}
