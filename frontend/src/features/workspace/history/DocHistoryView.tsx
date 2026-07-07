import { Suspense, lazy } from 'react';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { cn } from '../../../lib/cn';
import { PageLoader } from '../../../components/Loader';
import { relativeTime } from '../../../lib/time';
import { useDocHistory, useDocSnapshot } from '../../../hooks/usePages';
import type { DocumentDto } from '../../../types/api';
import { useHistoryMode } from './useHistoryMode';

const DocSnapshotViewer = lazy(() =>
  import('./DocSnapshotViewer').then((m) => ({ default: m.DocSnapshotViewer })),
);

const styles = {
  contentShell: 'flex-1 min-w-0 flex flex-col bg-[var(--panel-bg)]',
  center: 'flex-1 flex items-center justify-center',
  // Read-only banner marking this as a past version (matches the doc title inset).
  banner:
    'flex-none w-full max-w-[760px] mx-auto mt-4 px-[88px] py-2 text-body-xs text-secondary',
  title: 'flex-none w-full max-w-[760px] mx-auto pt-7 px-[88px] text-heading-1 font-semibold text-primary',
};

type DocHistoryViewProps = { doc: DocumentDto };

// Content pane while a DOC is in history mode: the selected version's title +
// a read-only render of its state at that update seq.
export function DocHistoryView({ doc }: Readonly<DocHistoryViewProps>) {
  const { selectedSeq } = useHistoryMode();
  const { data: history } = useDocHistory(doc.id);

  const sessions = history?.sessions ?? [];
  const session = selectedSeq != null ? sessions.find((s) => s.lastSeq === selectedSeq) : sessions[0];
  // Default to the newest version when the URL names none.
  const effectiveSeq = selectedSeq ?? sessions[0]?.lastSeq ?? null;

  const { data: snapshot, isLoading, isError } = useDocSnapshot(doc.id, effectiveSeq);

  if (isError) {
    return (
      <main className={styles.contentShell}>
        <div className={styles.center}>
          <EmptyState
            dsVersion="2.0"
            illustration={EmptyStateIllustrations.Error404Illustration}
            title="Couldn't load this version"
            subtitle="Try selecting another version from the list."
          />
        </div>
      </main>
    );
  }

  const when = session ? relativeTime(new Date(session.endedAt).toISOString()) : '';
  const who = session?.user?.name;

  return (
    <main className={styles.contentShell}>
      <div className={styles.title}>{doc.title || 'Untitled'}</div>
      <div className={cn(styles.banner)}>
        {effectiveSeq == null
          ? 'No versions to preview.'
          : `Viewing version · ${when} · ${who ? `edited by ${who}` : 'archived'}`}
      </div>
      {effectiveSeq != null && (
        <Suspense fallback={<PageLoader />}>
          {isLoading || !snapshot ? (
            <PageLoader />
          ) : (
            <DocSnapshotViewer
              key={effectiveSeq}
              docId={doc.id}
              seq={effectiveSeq}
              yjsStateB64={snapshot.yjsStateB64}
            />
          )}
        </Suspense>
      )}
    </main>
  );
}
