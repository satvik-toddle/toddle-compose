import { Icon } from '../../components/Icon';
import { workspaceVisual, type WorkspaceHue } from '../../lib/workspaceVisual';
import { formatDate } from '../../lib/time';
import type { Workspace } from '../../types/api';
import s from './WorkspaceCard.module.scss';
import {
  ChatDotsOutlined,
  EyeOutlined,
  PencilOutlined,
  UserProfileOutlined,
} from '@toddle-edu/ds-icons';

export function WorkspaceCard({
  ws,
  onEnter,
  showRoleBadge = false,
}: {
  ws: Workspace;
  onEnter: () => void;
  showRoleBadge?: boolean;
}) {
  const vis = workspaceVisual(ws.id);
  return (
    <div
      className={s.wsCard}
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onEnter}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEnter();
        }
      }}
    >
      <div className={s.wsCardTop}>
        <span className="ws-emoji" style={{ background: `var(--tag-background-${vis.hue}-default)` }}>
          <Icon name={vis.icon} size={20} style={{ color: `var(--tag-foreground-${vis.hue})` }} />
        </span>
        <div className={s.wsCardNm}>{ws.name}</div>
        {showRoleBadge && <WorkspaceRoleBadge role={ws.role} />}
      </div>
      <div className={s.wsCardMeta}>
        <span>
          <Icon
            name={ws.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'}
            size={14}
            muted
          />
          {ws.visibility === 'PUBLIC' ? 'Public' : 'Private'}
        </span>
      </div>
      <div className={s.wsCardFoot}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Created {formatDate(ws.createdAt)}
        </span>
        <span className={s.enter}>
          Enter
          <Icon name="ChevronRightOutlined" size={14} />
        </span>
      </div>
    </div>
  );
}

const styles = {
  roleBadge: 'absolute -right-[15px] -top-[15px] flex rounded-2 p-1 text-center lowercase',
};

// DS tag hue per role → --tag-background/foreground-{hue} (flips with theme).
const ROLE_HUE: Record<string, WorkspaceHue> = {
  EDIT: 'blue',
  COMMENT: 'green',
  READ: 'orange',
  ADMIN: 'purple',
};

function WorkspaceRoleBadge({ role }: { role: Workspace['role'] }) {
  const hue = ROLE_HUE[role] ?? 'blue';
  const color = `var(--tag-foreground-${hue})`;
  return (
    <span
      className={styles.roleBadge}
      style={{ background: `var(--tag-background-${hue}-default)`, color }}
    >
      {
        {
          EDIT: <PencilOutlined size="xxx-small" overrideVariantStyles style={{ color }} />,
          COMMENT: <ChatDotsOutlined size="xxx-small" overrideVariantStyles style={{ color }} />,
          READ: <EyeOutlined size="xxx-small" overrideVariantStyles style={{ color }} />,
          ADMIN: <UserProfileOutlined size="xxx-small" overrideVariantStyles style={{ color }} />,
        }[role]
      }
    </span>
  );
}
