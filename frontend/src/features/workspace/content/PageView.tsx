import { Suspense, lazy } from 'react';
import { cn } from '../../../lib/cn';
import { EmptyState } from '../../../components/EmptyState';
import { PageLoader } from '../../../components/Loader';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { PageTitle } from './PageTitle';

// The editor bundle is large — load it only when a page is opened.
const DocEditor = lazy(() => import('../DocEditor').then((m) => ({ default: m.DocEditor })));

const styles = {
  contentShell: 'flex-1 min-w-0 flex flex-col bg-[var(--panel-bg)]',
  scrollBody: 'flex-1 overflow-auto pt-6 px-7.5 pb-10',
  // Title aligned to the editor's content column (760px + 88px text inset).
  titleColumn: 'flex-none w-full max-w-[760px] mx-auto pt-7 px-[88px]',
};

type PageViewProps = {
  ctx: WorkspaceCtx;
  docs: DocumentDto[];
  selDoc: string;
};

// Reader: a single page is open (via the `?doc=` param). Renders the editable
// title + the lazy editor, or a "not found" state for a stale/deleted id.
export function PageView({ ctx, docs, selDoc }: Readonly<PageViewProps>) {
  const openDoc = docs.find((doc) => doc.id === selDoc);

  if (!openDoc) {
    return (
      <main className={styles.contentShell}>
        <div className={cn(styles.scrollBody, 'flex items-center justify-center')}>
          <EmptyState glyph="🔍" title="Page not found">
            It may have been moved or deleted.
          </EmptyState>
        </div>
      </main>
    );
  }

  const { id: openDocId, title: pageTitle } = openDoc;
  const canEdit = wsAtLeast(ctx.role, 'EDIT');

  return (
    <main className={styles.contentShell}>
      <div className={styles.titleColumn}>
        <PageTitle
          workspaceId={ctx.workspaceId}
          docId={openDocId}
          title={pageTitle}
          canEdit={canEdit}
        />
      </div>
      <Suspense fallback={<PageLoader />}>
        <DocEditor key={openDocId} docId={openDocId} canEdit={canEdit} />
      </Suspense>
    </main>
  );
}
