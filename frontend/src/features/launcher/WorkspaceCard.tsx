import { Icon, type IconName } from '../../components/Icon';
import { WS_ROLE_META } from '../../lib/roles';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { formatDate } from '../../lib/time';
import type { Workspace } from '../../types/api';
import s from './WorkspaceCard.module.scss';

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
  const visibilityLabel = ws.visibility === 'PUBLIC' ? 'Public' : 'Private';
  // Explicit a11y name; else it concatenates all inner text incl. the noisy timestamp.
  const ariaLabel =
    `Open ${ws.name} workspace. ${visibilityLabel}` +
    (showRoleBadge ? `. Your role: ${WS_ROLE_META[ws.role].label}` : '');

  return (
    <div
      className={s.wsCard}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      style={{ cursor: 'pointer' }}
      onClick={onEnter}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEnter();
        }
      }}
    >
      {/* Identity: icon + name */}
      <div className={s.wsCardTop}>
        <span className="ws-emoji" style={{ background: `var(--tag-background-${vis.hue}-default)` }}>
          <Icon name={vis.icon} size={20} style={{ color: `var(--tag-foreground-${vis.hue})` }} />
        </span>
        <div className={s.wsCardNm}>{ws.name}</div>
      </div>

      {/* Status: visibility + role */}
      <div className={s.wsCardMeta}>
        <span>
          <Icon
            name={ws.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'}
            size={14}
            muted
          />
          {visibilityLabel}
        </span>
        {showRoleBadge && (
          <span>
            <Icon name={WS_ROLE_META[ws.role].icon as IconName} size={14} muted />
            {WS_ROLE_META[ws.role].label}
          </span>
        )}
      </div>

      {/* Action */}
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
