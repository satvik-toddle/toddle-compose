import { ProgressIndicator } from '@toddle-edu/ds-web';
import { useUploadStore, type UploadItem } from '../stores/uploadStore';
import { Icon } from './Icon';

// Tailwind DS utilities (RegisterPage convention) — no SCSS module.
const styles = {
  panel:
    'fixed right-6 bottom-6 z-[70] w-[360px] max-w-[calc(100vw-48px)] overflow-hidden rounded-3 border border-solid border-secondary bg-surface-secondary-enabled text-primary shadow-elevation-3-bottom',
  header:
    'flex items-center gap-2 border-b border-solid border-secondary bg-surface-primary-active py-2.5 pl-4 pr-2',
  title: 'flex-1 min-w-0 text-label-s text-primary',
  iconBtn:
    'inline-flex h-7 w-7 items-center justify-center rounded-1.5 border-0 bg-transparent hover:bg-surface-secondary-hover',
  list: 'max-h-80 overflow-y-auto',
  row: 'flex items-start gap-3 border-t border-solid border-secondary py-2.5 pl-4 pr-3 first:border-t-0',
  fileIcon: 'shrink-0 mt-0.5',
  meta: 'flex-1 min-w-0',
  name: 'text-body-s text-primary truncate',
  sub: 'mt-0.25 text-body-xs text-secondary',
  bar: 'mt-2',
  err: 'mt-1 text-body-xs text-semantic-error',
  trail: 'shrink-0 flex items-center gap-1',
  pct: 'text-body-xs text-secondary tabular-nums',
};

// Human-readable byte size (Google-Drive style): 0 → "—", else B/KB/MB.
function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Short type label from a mime string: "image/png" → "PNG", "application/pdf" → "PDF".
function typeLabel(type: string): string {
  if (!type) return 'File';
  const sub = type.split('/')[1] ?? type;
  return sub.split(/[+.;]/)[0].toUpperCase();
}

const isImage = (type: string) => type.startsWith('image/');

function Row({ item }: { item: UploadItem }) {
  const remove = useUploadStore((st) => st.remove);
  const done = item.status === 'done';
  const error = item.status === 'error';
  return (
    <div className={styles.row}>
      <span className={styles.fileIcon}>
        <Icon name={isImage(item.type) ? 'ImageSquareOutlined' : 'FileOutlined'} size={18} muted />
      </span>
      <div className={styles.meta}>
        <div className={styles.name} title={item.name}>
          {item.name}
        </div>
        <div className={styles.sub}>
          {formatSize(item.size)} · {typeLabel(item.type)}
        </div>
        {item.status === 'uploading' && (
          <div className={styles.bar}>
            <ProgressIndicator variant="progress-bar" progress={item.progress} />
          </div>
        )}
        {error && <div className={styles.err}>{item.error}</div>}
      </div>
      <span className={styles.trail}>
        {item.status === 'uploading' && <span className={styles.pct}>{item.progress}%</span>}
        {done && <Icon name="TickCircleOutlined" size={18} />}
        {error && <Icon name="WarningTriangleOutlined" size={18} red />}
        {item.status !== 'uploading' && (
          <button type="button" className={styles.iconBtn} aria-label="Dismiss" onClick={() => remove(item.id)}>
            <Icon name="CloseOutlined" size={14} muted />
          </button>
        )}
      </span>
    </div>
  );
}

// Bottom-right upload activity panel (Google-Drive style): per-file name, size, type, and live
// progress. Fed by uploadStore, which the doc editor's uploadToServer writes to.
export function UploadNotifications() {
  const items = useUploadStore((st) => st.items);
  const collapsed = useUploadStore((st) => st.collapsed);
  const setCollapsed = useUploadStore((st) => st.setCollapsed);
  const dismissAll = useUploadStore((st) => st.dismissAll);

  if (items.length === 0) return null;

  const uploading = items.filter((it) => it.status === 'uploading').length;
  const allSettled = uploading === 0;
  const header =
    uploading > 0
      ? `Uploading ${uploading} item${uploading > 1 ? 's' : ''}…`
      : `${items.length} upload${items.length > 1 ? 's' : ''} complete`;

  return (
    // Full-screen click-through .rbac layer scopes DS tokens (mirrors ToastHost); panel is fixed bottom-right.
    <div
      className="rbac"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        display: 'block',
        pointerEvents: 'none',
        height: 'auto',
      }}
    >
      <div className={styles.panel} style={{ pointerEvents: 'auto' }}>
        <div className={styles.header}>
          <span className={styles.title}>{header}</span>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="ChevronDownOutlined" size={16} muted className={collapsed ? 'rotate-180' : ''} />
          </button>
          {allSettled && (
            <button type="button" className={styles.iconBtn} aria-label="Close" onClick={dismissAll}>
              <Icon name="CloseOutlined" size={16} muted />
            </button>
          )}
        </div>
        {!collapsed && (
          <div className={styles.list}>
            {items.map((it) => (
              <Row key={it.id} item={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
