import { ChevronRightOutlined } from '@toddle-edu/ds-icons';
import { Tag } from '@toddle-edu/ds-web';
import { cn } from '../../../lib/cn';
import type { DocumentDto, SearchResultDto } from '../../../types/api';
import { pageTypeIcon } from '../../workspace/pageTypes';
import { buildBreadcrumbTrail } from '../../workspace/topbar/ancestorTrail';
import { Hit } from './Hit';

const styles = {
  row: 'group grid grid-cols-[auto_1fr_auto] w-full items-start gap-[13px] px-4 py-3 rounded-[11px] cursor-pointer text-left border-0',
  rowIdle: 'bg-transparent hover:bg-surface-secondary-enabled',
  // --red-950 isn't a DS Tailwind utility; the selected tint + inset ring are design values.
  rowActive:
    'bg-[var(--red-950)] shadow-[inset_0_0_0_1px_rgba(214,58,63,0.18)] dark:bg-[rgba(214,58,63,0.14)]',
  ic: 'flex-none flex items-center justify-center w-[34px] h-[34px] rounded-[9px] text-size-300 text-secondary bg-surface-secondary-enabled border border-solid border-secondary',
  body: 'min-w-0',
  nm: 'flex items-center gap-2 text-size-100 font-weight-600 text-primary tracking-[-0.005em]',
  nmText: 'truncate',
  badge: 'inline-flex items-center flex-none',
  snip: 'mt-0.75 text-size-75 leading-[1.5] text-secondary line-clamp-2',
  path: 'flex items-center gap-1.5 min-w-0 mt-1.5 text-size-50 text-secondary',
  trail: 'truncate',
  right: 'flex items-center gap-2 flex-none pt-0.5',
  enter: 'w-3.5 h-3.5 text-secondary opacity-0 group-hover:opacity-100',
};

// One search hit. `wsDocs` is the in-workspace document cache used to derive the
// ancestor trail; global rows use the row's own workspace instead.
export function ResultRow({
  doc,
  q,
  active,
  isGlobal,
  wsDocs,
  onClick,
}: {
  doc: SearchResultDto;
  q: string;
  active: boolean;
  isGlobal: boolean;
  wsDocs: DocumentDto[];
  onClick: () => void;
}) {
  const PageIcon = pageTypeIcon(doc.type);

  // In-workspace path = ancestor folder/doc trail (excludes the doc itself).
  // TODO: fold in the containing folder name (needs useFolders) for top-level docs.
  const ancestorTrail = isGlobal
    ? ''
    : buildBreadcrumbTrail(doc, wsDocs)
        .slice(0, -1)
        .map((s) => s.title)
        .join(' / ');

  return (
    <button
      type="button"
      className={cn(styles.row, active ? styles.rowActive : styles.rowIdle)}
      data-testid="sr"
      onClick={onClick}
    >
      <span className={styles.ic}>
        {doc.icon ? doc.icon : <PageIcon style={{ width: 18, height: 18 }} aria-hidden />}
      </span>
      <div className={styles.body}>
        <div className={styles.nm}>
          <span className={styles.nmText}>
            <Hit t={doc.title} q={q} />
          </span>
          {doc.match === 'title' && (
            <span className={styles.badge} data-testid="sr-badge">
              <Tag color="teal" size="small">
                Title
              </Tag>
            </span>
          )}
        </div>
        {doc.snippet && (
          // Shown for any row carrying a content hit — including title matches whose body also matches.
          <div className={styles.snip}>
            …<Hit t={doc.snippet} q={q} />…
          </div>
        )}
        {/* Subtext = in-workspace ancestor trail only; workspace name is intentionally not shown. */}
        {!isGlobal && ancestorTrail && (
          <div className={styles.path} data-testid="sr-path">
            <span className={styles.trail}>{ancestorTrail}</span>
          </div>
        )}
      </div>
      <div className={styles.right}>
        <ChevronRightOutlined
          className={cn(styles.enter, active && 'opacity-100')}
          aria-hidden
        />
      </div>
    </button>
  );
}
