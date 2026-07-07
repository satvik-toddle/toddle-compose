import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Dropdown, DropdownMenu, Tag } from '@toddle-edu/ds-web';
import {
  ChevronDownOutlined,
  DashboardOutlined,
  LogoutOutlined,
  OutlinedIcons,
  PaintBrushOutlined,
} from '@toddle-edu/ds-icons';
import { performLogout } from '../lib/session';
import { cn } from '../lib/cn';
import { dsAvatarColor, dsAvatarSize } from '../lib/dsAvatar';
import { isThemePreference, useThemeStore } from '../stores/themeStore';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';
import { isRealmAdmin, REALM_ROLE_META } from '../lib/roles';

const styles = {
  trigger: 'flex items-center rounded-full border border-secondary',
  triggerCompact: 'gap-1 py-0.75 pl-0.75 pr-1',
  triggerExpanded: 'gap-2.25 py-1 pl-1 pr-1.5',
  identity: 'flex flex-col leading-tight',
  name: 'text-label-s text-primary',
  role: 'text-body-xs text-secondary',
  menu: 'w-[240px] p-1.5 rounded-3 border border-secondary bg-surface-primary-enabled shadow-elevation-3-bottom z-[60]',
  menuHead: 'px-2.5 pt-2.5 pb-2 mb-1 border-b border-secondary',
  menuName: 'text-label text-primary',
  menuEmail: 'mt-0.25 text-body-s text-secondary',
  menuRole: 'mt-2',
  // Strip the standalone DropdownMenu's own panel chrome (border + inline
  // elevation shadow) so it sits flush inside this overlay.
  menuOptions: '[&_.dropdown-v2-overlay]:border-0 [&_.dropdown-v2-overlay]:!shadow-none',
};

const SIGN_OUT_KEY = 'signOut';
const ADMIN_CONSOLE_KEY = 'adminConsole';

// Prepended for realm OWNER/MAINTAINER only.
const ADMIN_MENU_OPTIONS = [
  {
    key: ADMIN_CONSOLE_KEY,
    label: 'Admin console',
    icon: <DashboardOutlined size="xx-small" />,
  },
  { key: 'divider-admin', isDivider: true },
];

const ACCOUNT_MENU_OPTIONS = [
  {
    key: 'theme',
    label: 'Theme',
    icon: <PaintBrushOutlined size="xx-small" />,
    isSubMenu: true,
    options: [
      { key: 'light', label: 'Light' },
      { key: 'dark', label: 'Dark' },
      { key: 'system', label: 'System' },
    ],
  },
  { key: 'divider', isDivider: true },
  {
    key: SIGN_OUT_KEY,
    label: 'Sign out',
    icon: <LogoutOutlined size="xx-small" />,
    isDestructive: true,
  },
];

const REALM_TAG_COLOR: Record<RealmRole, 'red' | 'violet' | 'neutral'> = {
  OWNER: 'red',
  MAINTAINER: 'violet',
  MEMBER: 'neutral',
};

// `compact` renders the workspace-topbar variant (avatar + chevron only).
export function AccountMenu({
  user,
  realmRole,
  compact,
}: Readonly<{
  user: User;
  realmRole?: RealmRole | null;
  compact?: boolean;
}>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const themePreference = useThemeStore((state) => state.preference);
  const setThemePreference = useThemeStore((state) => state.setPreference);

  const signOut = async () => {
    await performLogout(queryClient);
    navigate('/login');
  };

  const handleMenuOptionClick = (optionKey: string) => {
    if (optionKey === SIGN_OUT_KEY) {
      void signOut();
    } else if (optionKey === ADMIN_CONSOLE_KEY) {
      navigate('/admin');
    } else if (isThemePreference(optionKey)) {
      setThemePreference(optionKey);
    }
  };

  const menuOptions = isRealmAdmin(realmRole)
    ? [...ADMIN_MENU_OPTIONS, ...ACCOUNT_MENU_OPTIONS]
    : ACCOUNT_MENU_OPTIONS;

  const triggerClass = cn(styles.trigger, compact ? styles.triggerCompact : styles.triggerExpanded);
  const RealmRoleIcon = realmRole
    ? OutlinedIcons[REALM_ROLE_META[realmRole].icon as keyof typeof OutlinedIcons]
    : null;

  const menu = (
    <div className={styles.menu} role="menu">
      <div className={styles.menuHead}>
        <div className={styles.menuName}>{user.name}</div>
        <div className={styles.menuEmail}>{user.email}</div>
        {realmRole && RealmRoleIcon && (
          <div className={styles.menuRole}>
            <Tag
              dsVersion="2.0"
              size="small"
              color={REALM_TAG_COLOR[realmRole]}
              prefix={<RealmRoleIcon />}
            >
              {REALM_ROLE_META[realmRole].label}
            </Tag>
          </div>
        )}
      </div>

      <div className={styles.menuOptions}>
        <DropdownMenu
          dsVersion="2.0"
          options={menuOptions}
          value={themePreference}
          showSelection
          onClick={(option) => handleMenuOptionClick(option.key)}
        />
      </div>
    </div>
  );

  return (
    <Dropdown trigger={['click']} placement="bottomRight" overlay={menu}>
      {/* antd attaches its ref/onClick to this node */}
      <button type="button" className={triggerClass} aria-haspopup="menu">
        <Avatar
          dsVersion="2.0"
          name={user.name}
          color={dsAvatarColor(user.color)}
          size={dsAvatarSize(compact ? 30 : 28)}
          shape="circle"
        />
        {!compact && (
          <span className={styles.identity}>
            <span className={styles.name}>{user.name}</span>
            {realmRole && <span className={styles.role}>{REALM_ROLE_META[realmRole].label}</span>}
          </span>
        )}
        <ChevronDownOutlined size="xxx-small" variant="subtle" />
      </button>
    </Dropdown>
  );
}
