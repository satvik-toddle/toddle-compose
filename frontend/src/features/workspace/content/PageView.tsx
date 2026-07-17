import { Suspense, lazy } from 'react';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { cn } from '../../../lib/cn';
import { PageLoader } from '../../../components/Loader';
import { maxWsRole, wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { PageTitle } from './PageTitle';

// The editor bundles are large — load them only when a page is opened.
const DocEditor = lazy(() => import('../DocEditor').then((m) => ({ default: m.DocEditor })));
const SheetEditor = lazy(() =>
  import('../sheet/SheetEditor').then((m) => ({ default: m.SheetEditor })),
);

const styles = {
  contentShell: 'flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--panel-bg)]',
  scrollBody: 'flex-1 overflow-auto pt-6 px-7.5 pb-10',
  // Doc: title + editor share this scroll container so the title scrolls with the content.
  docScroll: 'flex-1 min-h-0 overflow-y-auto flex flex-col',
  // Doc: title centered over the editor's readable column (760px + 88px text inset).
  docTitle: 'flex-none w-full max-w-[760px] mx-auto pt-7 px-[88px]',
  // Sheet: title full-width, left-aligned to the grid's left edge (matches its p-6 inset).
  sheetTitle: 'flex-none w-full pt-7 px-6',
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
          <EmptyState
            dsVersion="2.0"
            illustration={EmptyStateIllustrations.Error404Illustration}
            title="Page not found"
            subtitle="It may have been moved or deleted."
          />
        </div>
      </main>
    );
  }

  const { id: openDocId, title: pageTitle } = openDoc;
  // Max of workspace role and per-page grant — else an EDIT-grantee guest would get a read-only editor.
  const canEdit = wsAtLeast(maxWsRole(ctx.role, openDoc.myRole ?? null), 'EDIT');
  const isSheet = openDoc.type === 'SHEET';

  const titleNode = (
    <PageTitle workspaceId={ctx.workspaceId} docId={openDocId} title={pageTitle} canEdit={canEdit} />
  );

  return (
    <main className={styles.contentShell}>
      {isSheet ? (
        // Sheet: fixed title over the grid (the grid scrolls itself).
        <>
          <div className={styles.sheetTitle}>{titleNode}</div>
          <Suspense fallback={<PageLoader />}>
            <SheetEditor key={openDocId} docId={openDocId} />
          </Suspense>
        </>
      ) : (
        // Keyed so scroll position (and the editor) resets per document.
        <div key={openDocId} className={styles.docScroll}>
          <div className={styles.docTitle}>{titleNode}</div>
          <Suspense fallback={<PageLoader />}>
            <DocEditor docId={openDocId} canEdit={canEdit} />
          </Suspense>
        </div>
      )}
    </main>
  );
}
