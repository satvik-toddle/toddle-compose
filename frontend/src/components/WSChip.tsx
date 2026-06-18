import { Tag } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';
import { WS_ROLE_META } from '../lib/roles';
import type { WorkspaceRole } from '../types/roles';

const COLOR: Record<WorkspaceRole, string> = {
  READ: 'neutral',
  COMMENT: 'blue',
  EDIT: 'teal',
  ADMIN: 'violet',
};

export interface WSChipProps {
  role?: WorkspaceRole;
  // Realm admin acting as workspace Admin everywhere → dashed "via realm" chip.
  overlay?: boolean;
  sm?: boolean;
}

export function WSChip({ role, overlay }: WSChipProps) {
  if (overlay) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Tag color="neutral" type={'outlined' as any} size="small" prefix={<Icon name="SettingsOutlined" size={12} />}>
        Admin · via realm
      </Tag>
    );
  }
  if (!role) return null;
  const m = WS_ROLE_META[role];
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag color={COLOR[role] as any} size="small" prefix={<Icon name={m.icon as IconName} size={12} />}>
      {m.label}
    </Tag>
  );
}
