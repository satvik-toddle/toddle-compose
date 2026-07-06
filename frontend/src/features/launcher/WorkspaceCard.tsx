import { Icon } from '../../components/Icon';
import { workspaceVisual } from '../../lib/workspaceVisual';
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
        <span
          className="ws-emoji"
          style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
        >
          <Icon name={vis.icon} size={20} style={{ color: vis.color }} />
        </span>
        <div className={s.wsCardNm}>{ws.name}</div>
        {/* Grant-only access: a plain tag instead of the member role badge. */}
        {ws.guest && <span className={styles.guestTag}>Guest</span>}
        {showRoleBadge && !ws.guest && <WorkspaceRoleBadge role={ws.role} />}
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
  guestTag:
    'ml-auto flex-none rounded-1 border border-secondary px-1.5 py-0.5 text-body-xs text-secondary',
};

// Bare `r,g,b` triplets — consumed via rgba(var(--bg-color), …) in the stylesheet.
const ROLE_BG: Record<string, string> = {
  EDIT: '31,111,226', // blue
  COMMENT: '46,160,67', // green
  READ: '227,142,18', // orange
  ADMIN: '197,67,241', // purple
};

function WorkspaceRoleBadge({ role }: { role: Workspace['role'] }) {
  const rgb = ROLE_BG[role] ?? '0,0,0';
  const color = `rgb(${rgb})`;
  return (
    <span
      className={styles.roleBadge}
      style={{ background: `rgba(${rgb},0.1)`, color }}
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
