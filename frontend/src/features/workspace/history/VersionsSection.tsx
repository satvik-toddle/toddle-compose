import { CloseOutlined } from '@toddle-edu/ds-icons';
import { IconButton, ToggleSwitch } from '@toddle-edu/ds-web';
import { relativeTime } from '../../../lib/time';
import { cn } from '../../../lib/cn';
import { Avatar } from '../../../components/Avatar';
import { PageLoader } from '../../../components/Loader';
import { useHistoryMode } from './useHistoryMode';
import { useVersionSelection } from './useVersionSelection';
import { sidebarRowState } from '../sidebar/sidebarRowStyles';
import type { DocHistorySession } from '../../../types/api';

const styles = {
  head: 'flex items-center justify-between px-2.25 pb-2 pt-1',
  heading: 'text-label-xs uppercase text-secondary',
  message: 'px-2.25 py-4 text-body-s text-secondary',
  // Row for the "Show changes" toggle, aligned with the version rows.
  toggleRow: 'flex items-center justify-between px-2.25 pb-2',
  toggleLabel: 'text-body-s text-primary',
  list: 'flex flex-col gap-0.25',
  // Two-line row, so its own layout, but shares the sidebar's hover/selected/focus tokens.
  row: `flex w-full items-start gap-2.5 rounded-2 px-2.25 py-2 text-left ${sidebarRowState.focus}`,
  rowDefault: sidebarRowState.hover,
  rowSelected: sidebarRowState.selected,
  rowBody: 'flex min-w-0 flex-col',
  name: 'truncate text-body-s text-primary',
  nameSelected: 'font-semibold',
  meta: 'truncate text-body-xs text-secondary',
};

// One row per edit session: who edited, when, and how much.
function VersionRow({
  session,
  selected,
  onSelect,
}: Readonly<{ session: DocHistorySession; selected: boolean; onSelect: () => void }>) {
  const isArchive = session.kind === 'archive';
  const name = isArchive ? 'Archived' : (session.user?.name ?? 'Unknown editor');
  const when = relativeTime(session.endedAt);
  // Archived rows already say "Archived" as the name; repeating it in the meta line is noise.
  const meta = isArchive
    ? when
    : `${when} · ${session.updateCount} edit${session.updateCount === 1 ? '' : 's'}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(styles.row, selected ? styles.rowSelected : styles.rowDefault)}
    >
      <Avatar person={{ name, color: session.user?.color }} size={24} />
      <span className={styles.rowBody}>
        <span className={cn(styles.name, selected && styles.nameSelected)}>{name}</span>
        <span className={styles.meta}>{meta}</span>
      </span>
    </button>
  );
}

// Left-panel content when a doc is in history mode: the edit-session timeline,
// newest first. Selecting a row previews that version in the content pane.
export function VersionsSection({ docId }: Readonly<{ docId: string }>) {
  const { select, exit, diff, setDiff } = useHistoryMode();
  const { sessions, isLoading, isError, effectiveSeq } = useVersionSelection(docId);

  return (
    <div>
      <div className={styles.head}>
        <span className={styles.heading}>Version history</span>
        <IconButton
          dsVersion="2.0"
          variant="neutral"
          type="plain"
          size="xxx-small"
          icon={<CloseOutlined />}
          aria-label="Exit version history"
          onClick={exit}
        />
      </div>

      {isLoading && <PageLoader />}
      {isError && <div className={styles.message}>Couldn&apos;t load version history.</div>}
      {!isLoading && !isError && sessions.length === 0 && (
        <div className={styles.message}>No edits recorded yet.</div>
      )}

      {!isLoading && !isError && sessions.length > 0 && (
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Show changes</span>
          <ToggleSwitch
            dsVersion="2.0"
            checked={diff}
            onChange={(e) => setDiff((e.target as HTMLInputElement).checked)}
            aria-label="Compare this version with the previous one"
          />
        </div>
      )}

      <div className={styles.list}>
        {sessions.map((session) => (
          <VersionRow
            key={session.lastSeq}
            session={session}
            selected={session.lastSeq === effectiveSeq}
            onSelect={() => select(session.lastSeq)}
          />
        ))}
      </div>
    </div>
  );
}
