import { Tag } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';
import { REALM_ROLE_META } from '../lib/roles';
import type { RealmRole } from '../types/roles';

const COLOR: Record<RealmRole, string> = {
  OWNER: 'red',
  MAINTAINER: 'violet',
  MEMBER: 'neutral',
};

export function RealmChip({ role }: { role: RealmRole; sm?: boolean }) {
  const m = REALM_ROLE_META[role];
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag color={COLOR[role] as any} size="small" prefix={<Icon name={m.icon as IconName} size={12} />}>
      {m.label}
    </Tag>
  );
}
