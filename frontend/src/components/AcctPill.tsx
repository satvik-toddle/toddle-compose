import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Dropdown } from '@toddle-edu/ds-web';
import { ChevronDownOutlined } from '@toddle-edu/ds-icons';
import { performLogout } from '../lib/session';
import { RealmChip } from './RealmChip';
import { cn } from '../lib/cn';
import { dsAvatarColor, dsAvatarSize } from '../lib/dsAvatar';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';
import { REALM_ROLE_META } from '../lib/roles';

const styles = {
  trigger: 'flex items-center rounded-full border border-secondary',
  triggerCompact: 'gap-1 py-0.75 pl-0.75 pr-1',
  triggerExpanded: 'gap-2.25 py-1 pl-1 pr-1.5',
  who: 'flex flex-col leading-tight',
  name: 'text-label-s',
  role: 'text-body-xs text-secondary',
  menu: 'w-[240px] p-1.5 rounded-3 border border-secondary bg-surface-primary-enabled shadow-elevation-3-bottom z-[60]',
  menuHead: 'px-2.5 pt-2.5 pb-2 mb-1 border-b border-secondary',
  menuName: 'text-label',
  menuEmail: 'mt-0.25 text-body-s text-secondary',
  menuRole: 'mt-2',
};

// Account pill + dropdown (name, email, realm role badge, sign out). `compact`
// renders the workspace-topbar variant (avatar + chevron only). Open state,
// click-outside, and positioning come from the ds-web Dropdown; the card content
// is custom (the DS has no account-menu component).
export function AcctPill({
  me,
  realmRole,
  compact,
}: Readonly<{
  me: User;
  realmRole?: RealmRole | null;
  compact?: boolean;
}>) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await performLogout(qc);
    navigate('/login');
  };

  const triggerClass = cn(styles.trigger, compact ? styles.triggerCompact : styles.triggerExpanded);

  const menu = (
    <div className={styles.menu} role="menu">
      <div className={styles.menuHead}>
        <div className={styles.menuName}>{me.name}</div>
        <div className={styles.menuEmail}>{me.email}</div>
        {realmRole && (
          <div className={styles.menuRole}>
            <RealmChip role={realmRole} sm />
          </div>
        )}
      </div>
      <Button dsVersion="2.0" isFullWidth onClick={signOut}>
        Sign out
      </Button>
    </div>
  );

  return (
    <Dropdown trigger={['click']} placement="bottomRight" overlay={menu}>
      {/* antd attaches its ref/onClick to this node */}
      <button type="button" className={triggerClass} aria-haspopup="menu">
        <Avatar
          dsVersion="2.0"
          name={me.name}
          color={dsAvatarColor(me.color)}
          size={dsAvatarSize(compact ? 30 : 28)}
          shape="circle"
        />
        {!compact && (
          <span className={styles.who}>
            <span className={styles.name}>{me.name}</span>
            {realmRole && <span className={styles.role}>{REALM_ROLE_META[realmRole].label}</span>}
          </span>
        )}
        <ChevronDownOutlined size="xxx-small" variant="subtle" />
      </button>
    </Dropdown>
  );
}
