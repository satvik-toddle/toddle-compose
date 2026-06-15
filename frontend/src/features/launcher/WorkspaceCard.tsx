import { Icon } from '../../components/Icon';
import { WSChip } from '../../components/WSChip';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { formatDate } from '../../lib/time';
import type { Workspace } from '../../types/api';

export function WorkspaceCard({
  ws,
  overlay,
  onEnter,
}: {
  ws: Workspace;
  overlay?: boolean;
  onEnter: () => void;
}) {
  const vis = workspaceVisual(ws.id);
  return (
    <div
      className="ws-card"
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
      <div className="ws-card-top">
        <span
          className="ws-emoji"
          style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
        >
          <Icon name={vis.icon} size={24} style={{ color: vis.color }} />
        </span>
        {overlay ? <WSChip overlay sm /> : <WSChip role={ws.role} sm />}
      </div>
      <div className="ws-card-nm">{ws.name}</div>
      <div className="ws-card-meta">
        <span>
          <Icon name={ws.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'} size={14} muted />
          {ws.visibility === 'PUBLIC' ? 'Public' : 'Private'}
        </span>
      </div>
      <div className="ws-card-foot">
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Created {formatDate(ws.createdAt)}
        </span>
        <span className="enter">
          Enter
          <Icon name="ChevronRightOutlined" size={14} />
        </span>
      </div>
    </div>
  );
}
