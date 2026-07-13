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

// Who/when suffix for the selected version; null when ?v names a seq no session matches.
function sessionLabel(session: DocHistorySession | undefined): string | null {
  if (!session) return null;
  const when = relativeTime(session.endedAt);
  if (session.kind === 'archive') return `${when} · archived`;
  return `${when} · edited by ${session.user?.name ?? 'unknown'}`;
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

  // The previous version is the next-older session in the newest-first list; the oldest diffs
  // against the empty doc (seq 0). When ?v names a seq NO session matches (e.g. a stale link
  // after compaction rewrote boundaries), there is no meaningful baseline — diffing against 0
  // would render the whole doc as "added", so diff mode degrades to the plain snapshot instead.
  const selectedIdx = sessions.findIndex((sess) => sess.lastSeq === effectiveSeq);
  const diffBaseline = selectedIdx >= 0 ? (sessions[selectedIdx + 1]?.lastSeq ?? 0) : null;
  const diffActive = diff && diffBaseline != null;
  // One query returns the snapshot, plus the server-computed merged diff in diff mode.
  const { data: snapshot, isLoading: snapLoading, isError: snapError } = useDocSnapshot(
    doc.id,
    effectiveSeq,
    diffActive ? diffBaseline : undefined,
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
  const stateJson = diffActive ? snapshot?.diffJson : snapshot?.lexicalJson;

  const label = sessionLabel(session);
  const banner =
    effectiveSeq == null
      ? 'No versions to preview.'
      : diffActive
        ? `Comparing with previous version${label ? ` · ${label}` : ''}`
        : `Viewing version${label ? ` · ${label}` : ''}`;

  return (
    <main className={styles.contentShell}>
      <div className={styles.docTitle}>
        <PageTitle workspaceId={workspaceId} docId={doc.id} title={doc.title} canEdit={false} />
      </div>
      <div className={styles.banner}>{banner}</div>
      {effectiveSeq != null && (
        <Suspense fallback={<PageLoader />}>
          {loading ? (
            <PageLoader />
          ) : stateJson ? (
            <DocSnapshotViewer
              key={`${diffActive ? `diff-${diffBaseline}-` : ''}${effectiveSeq}`}
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
