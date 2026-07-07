import { Suspense, lazy } from 'react';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { cn } from '../../../lib/cn';
import { PageLoader } from '../../../components/Loader';
import { relativeTime } from '../../../lib/time';
import { useDocSnapshot } from '../../../hooks/usePages';
import type { DocumentDto } from '../../../types/api';
import { useVersionSelection } from './useVersionSelection';

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

function ErrorPane() {
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

// The banner text for the selected version. `session` is undefined when ?v names a
// seq no session matches — show a neutral label rather than a blank ' ·  · archived'.
function bannerText(
  session: ReturnType<typeof useVersionSelection>['session'],
): string {
  if (!session) return 'Viewing version';
  const when = relativeTime(new Date(session.endedAt).toISOString());
  if (session.kind === 'archive') return `Viewing version · ${when} · archived`;
  return `Viewing version · ${when} · edited by ${session.user?.name ?? 'unknown'}`;
}

// Content pane while a DOC is in history mode: the selected version's title +
// a read-only render of its state at that update seq.
export function DocHistoryView({ doc }: Readonly<DocHistoryViewProps>) {
  const {
    isLoading: sessionsLoading,
    isError: sessionsError,
    effectiveSeq,
    session,
  } = useVersionSelection(doc.id);

  const { data: snapshot, isLoading: snapLoading, isError: snapError } = useDocSnapshot(
    doc.id,
    effectiveSeq,
  );

  if (sessionsLoading) {
    return (
      <main className={styles.contentShell}>
        <PageLoader />
      </main>
    );
  }

  if (sessionsError || snapError) {
    return <ErrorPane />;
  }

  return (
    <main className={styles.contentShell}>
      <div className={styles.title}>{doc.title || 'Untitled'}</div>
      <div className={cn(styles.banner)}>
        {effectiveSeq == null ? 'No versions to preview.' : bannerText(session)}
      </div>
      {effectiveSeq != null && (
        <Suspense fallback={<PageLoader />}>
          {snapLoading || !snapshot ? (
            <PageLoader />
          ) : (
            <DocSnapshotViewer
              key={effectiveSeq}
              docId={doc.id}
              yjsStateB64={snapshot.yjsStateB64}
            />
          )}
        </Suspense>
      )}
    </main>
  );
}
