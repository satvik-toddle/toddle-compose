import { Suspense, lazy } from 'react';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { PageLoader } from '../../../components/Loader';
import { relativeTime } from '../../../lib/time';
import { useDocSnapshot } from '../../../hooks/usePages';
import type { DocumentDto, DocHistorySession } from '../../../types/api';
import { PageTitle } from '../content/PageTitle';
import { useHistoryMode } from './useHistoryMode';
import { useVersionSelection } from './useVersionSelection';

const DocSnapshotViewer = lazy(() =>
  import('./DocSnapshotViewer').then((m) => ({ default: m.DocSnapshotViewer })),
);

const styles = {
  // min-h-0 lets the editor pane shrink to the viewport so its own overflow scroll engages (long docs).
  contentShell: 'flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--panel-bg)]',
  center: 'flex-1 flex items-center justify-center',
  // Read-only banner marking this as a past version (matches the doc title inset).
  banner:
    'flex-none w-full max-w-[760px] mx-auto mt-4 px-[88px] py-2 text-body-xs text-secondary',
  // Same inset wrapper as PageView's docTitle so the reused PageTitle lines up with the live editor.
  docTitle: 'flex-none w-full max-w-[760px] mx-auto pt-7 px-[88px]',
};

type DocHistoryViewProps = { doc: DocumentDto; workspaceId: string };

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

// Banner for the selected version; neutral label when ?v names a seq no session matches.
function bannerText(session: DocHistorySession | undefined): string {
  if (!session) return 'Viewing version';
  const when = relativeTime(session.endedAt);
  if (session.kind === 'archive') return `Viewing version · ${when} · archived`;
  return `Viewing version · ${when} · edited by ${session.user?.name ?? 'unknown'}`;
}

// Content pane while a DOC is in history mode: the version's title + a read-only render at that seq (or a diff against the previous version when `?diff=true`).
export function DocHistoryView({ doc, workspaceId }: Readonly<DocHistoryViewProps>) {
  const { diff } = useHistoryMode();
  const {
    sessions,
    isLoading: sessionsLoading,
    isError: sessionsError,
    effectiveSeq,
    session,
  } = useVersionSelection(doc.id);

  // The previous version is the next-older session in the newest-first list; the oldest diffs against the empty doc (seq 0).
  const selectedIdx = sessions.findIndex((sess) => sess.lastSeq === effectiveSeq);
  const prevSeq = selectedIdx >= 0 ? (sessions[selectedIdx + 1]?.lastSeq ?? 0) : 0;
  // One query returns the snapshot, plus the server-computed merged diff in diff mode.
  const { data: snapshot, isLoading: snapLoading, isError: snapError } = useDocSnapshot(
    doc.id,
    effectiveSeq,
    diff ? prevSeq : undefined,
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

  const loading = snapLoading || !snapshot;
  const stateJson = diff ? snapshot?.diffJson : snapshot?.lexicalJson;

  return (
    <main className={styles.contentShell}>
      <div className={styles.docTitle}>
        <PageTitle workspaceId={workspaceId} docId={doc.id} title={doc.title} canEdit={false} />
      </div>
      <div className={styles.banner}>
        {effectiveSeq == null
          ? 'No versions to preview.'
          : diff
            ? `Comparing with previous version · ${bannerText(session).replace(/^Viewing version · /, '')}`
            : bannerText(session)}
      </div>
      {effectiveSeq != null && (
        <Suspense fallback={<PageLoader />}>
          {loading ? (
            <PageLoader />
          ) : stateJson ? (
            <DocSnapshotViewer
              key={`${diff ? `diff-${prevSeq}-` : ''}${effectiveSeq}`}
              editorStateJson={stateJson}
            />
          ) : (
            <ErrorPane />
          )}
        </Suspense>
      )}
    </main>
  );
}
