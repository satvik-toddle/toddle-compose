import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Dropdown, DropdownMenu, Tag } from '@toddle-edu/ds-web';
import {
  DashboardOutlined,
  LogoutOutlined,
  OutlinedIcons,
  PaintBrushOutlined,
} from '@toddle-edu/ds-icons';
import { performLogout } from '../lib/session';
import { dsAvatarColor, dsAvatarSize } from '../lib/dsAvatar';
import { isThemePreference, useThemeStore } from '../stores/themeStore';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';
import { isRealmAdmin, REALM_ROLE_META } from '../lib/roles';

const styles = {
  // Bare circular avatar — no pill/border chrome, no name or chevron. A subtle
  // ring surfaces on hover/focus so it still reads as an interactive trigger.
  trigger:
    'flex items-center justify-center rounded-full outline-none transition-shadow ' +
    'hover:shadow-[0_0_0_2px_var(--border-hover)] ' +
    'focus-visible:shadow-[0_0_0_2px_var(--border-focus)]',
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

export function AccountMenu({
  user,
  realmRole,
}: Readonly<{
  user: User;
  realmRole?: RealmRole | null;
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
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.name}`}
      >
        <Avatar
          dsVersion="2.0"
          name={user.name}
          color={dsAvatarColor(user.color, user.id)}
          size={dsAvatarSize(32)}
          shape="circle"
        />
      </button>
    </Dropdown>
  );
}
