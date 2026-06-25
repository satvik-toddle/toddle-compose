import type { CSSProperties } from 'react';
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
}: {
  ws: Workspace;
  overlay?: boolean;
  onEnter: () => void;
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
        <WorkspaceRoleBadge role={ws.role} />
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

// Bare `r,g,b` triplets — consumed via rgba(var(--bg-color), …) in the stylesheet.
const ROLE_BG: Record<string, string> = {
  EDIT: '31,111,226', // red
  COMMENT: '46,160,67', // green
  READ: '227,142,18', // yellow
  ADMIN : '197,67,241'
};

function WorkspaceRoleBadge({ role }: { role: Workspace['role'] }) {
  if (['MAINTAINER', 'OWNER'].includes(role)) return null;
  return (
    <span
      className={s.wsCardRole}
      style={{ '--bg-color': ROLE_BG[role] ?? '0,0,0' } as CSSProperties}
    >
      {
        {
          EDIT: <PencilOutlined size={'xxx-small'} />,
          COMMENT: <ChatDotsOutlined size={'xxx-small'} />,
          READ: <EyeOutlined size={'xxx-small'} />,
          ADMIN: <UserProfileOutlined size={'xxx-small'} />,
        }[role]
      }
    </span>
  );
}
