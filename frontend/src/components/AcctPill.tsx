import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dropdown } from '@toddle-edu/ds-web';
import { performLogout } from '../lib/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { RealmChip } from './RealmChip';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';
import { REALM_ROLE_META } from '../lib/roles';

// ds-web Dropdown is antd-based with version-switching unions; use untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DsDropdown = Dropdown as unknown as ComponentType<any>;

// Account pill + dropdown (name, email, realm role badge, sign out). `compact`
// renders the workspace-topbar variant (avatar + chevron only). Open state,
// click-outside, and positioning come from the ds-web Dropdown; the card content
// is custom (the DS has no account-menu component).
export function AcctPill({
  me,
  realmRole,
  compact,
}: {
  me: User;
  realmRole?: RealmRole | null;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await performLogout(qc);
    navigate('/login');
  };

  const menu = (
    <div className="acct-menu" role="menu">
      <div className="am-head">
        <div className="nm">{me.name}</div>
        <div className="sub">{me.email}</div>
        {realmRole && (
          <div style={{ marginTop: 8 }}>
            <RealmChip role={realmRole} sm />
          </div>
        )}
      </div>
      <button type="button" className="am-row" role="menuitem" onClick={signOut}>
        <Icon name="ChevronLeftOutlined" size={14} muted />
        Sign out
      </button>
    </div>
  );

  return (
    <DsDropdown trigger={['click']} placement="bottomRight" overlay={menu}>
      {/* antd attaches its ref/onClick to this node */}
      <button type="button" className={compact ? 'ws-acct' : 'acct'} aria-haspopup="menu">
        <Avatar person={{ name: me.name, color: me.color }} size={compact ? 30 : 28} />
        {!compact && (
          <span className="who">
            <span className="nm">{me.name}</span>
            {realmRole && <span className="sub">{REALM_ROLE_META[realmRole].label}</span>}
          </span>
        )}
        <Icon name="ChevronDownOutlined" size={14} muted style={{ marginRight: compact ? 0 : 2 }} />
      </button>
    </DsDropdown>
  );
}
