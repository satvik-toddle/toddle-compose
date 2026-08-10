import { Icon, type IconName } from '../../components/Icon';
import { WS_ROLE_META } from '../../lib/roles';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { formatDate } from '../../lib/time';
import type { Workspace } from '../../types/api';

const s = {
  card:
    'group flex flex-col gap-0 text-left cursor-pointer rounded-3 border-1 border-[var(--line)] bg-[var(--panel-bg)] p-[18px] ' +
    'transition-[box-shadow,transform,border-color] duration-[140ms] ' +
    'hover:shadow-elevation-2-bottom hover:border-[var(--border-hover)] hover:-translate-y-0.25',
  top: 'flex items-center gap-2.5 mb-3.5',
  name: 'flex-1 min-w-0 truncate text-[17px] font-bold',
  meta: 'flex items-center gap-4 mt-1.5 text-[12px] text-secondary',
  metaItem: 'inline-flex items-center gap-1.5',
  foot: 'flex items-center justify-between mt-4 pt-3.5 border-t border-[var(--line)]',
  created: 'text-[12px] text-secondary',
  // group-hover nudges the chevron right; the icon tints from currentColor.
  enter:
    'inline-flex items-center gap-0.75 text-[13px] font-bold text-[var(--interactive-primary)] ' +
    'transition-[gap] duration-[120ms] ease-in-out group-hover:gap-[5px]',
};

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
      className={s.card}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onEnter}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEnter();
        }
      }}
    >
      <div className={s.top}>
        <span className="ws-emoji" style={{ background: `var(--tag-background-${vis.hue}-default)` }}>
          <Icon name={vis.icon} size={20} style={{ color: `var(--tag-foreground-${vis.hue})` }} />
        </span>
        <div className={s.name}>{ws.name}</div>
      </div>

      <div className={s.meta}>
        <span className={s.metaItem}>
          <Icon
            name={ws.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'}
            size={14}
            muted
          />
          {visibilityLabel}
        </span>
        {showRoleBadge && (
          <span className={s.metaItem}>
            <Icon name={WS_ROLE_META[ws.role].icon as IconName} size={14} muted />
            {WS_ROLE_META[ws.role].label}
          </span>
        )}
      </div>

      <div className={s.foot}>
        <span className={s.created}>Created {formatDate(ws.createdAt)}</span>
        <span className={s.enter}>
          Enter
          <Icon name="ChevronRightOutlined" size={14} />
        </span>
      </div>
    </div>
  );
}

const add = {
  card:
    'flex flex-col items-center justify-center gap-[5px] min-h-[150px] text-center cursor-pointer rounded-3 p-[18px] ' +
    'border-1 border-dashed border-[var(--border-primary)] bg-transparent ' +
    'transition-[box-shadow,border-color] duration-[140ms] ' +
    'hover:bg-surface-secondary-enabled hover:border-[var(--border-hover)] hover:shadow-elevation-2-bottom',
  glyph:
    'flex items-center justify-center w-[46px] h-[46px] mb-1.5 rounded-[13px] bg-[var(--surface-tertiary-enabled)]',
  nm: 'text-[15px] font-bold',
  ds: 'text-[12px] text-secondary',
};

export function AddWorkspaceCard({ onClick }: { onClick: () => void }) {
  return (
    <button className={add.card} onClick={onClick}>
      <span className={add.glyph}>
        <Icon name="AddOutlined" size={20} muted />
      </span>
      <span className={add.nm}>New workspace</span>
      <span className={add.ds}>Create a space and invite your team</span>
    </button>
  );
}
