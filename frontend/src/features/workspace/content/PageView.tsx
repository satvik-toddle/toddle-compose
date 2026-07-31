import { Suspense, lazy } from 'react';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { cn } from '../../../lib/cn';
import { PageLoader } from '../../../components/Loader';
import { useOpenDoc } from '../../../hooks/usePages';
import { maxWsRole, wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { DOC_COLUMN_WIDTH, DOC_TEXT_INSET } from '../constants';
import { PageTitle } from './PageTitle';

// The editor bundles are large — load them only when a page is opened.
const DocEditor = lazy(() => import('../DocEditor').then((m) => ({ default: m.DocEditor })));
const SheetEditor = lazy(() =>
  import('../sheet/SheetEditor').then((m) => ({ default: m.SheetEditor })),
);
const WhiteboardEditor = lazy(() =>
  import('../whiteboard/WhiteboardEditor').then((m) => ({ default: m.WhiteboardEditor })),
);

const styles = {
  // Scroll happens HERE (title + editor together), below the fixed topbar; the editor's own
  // scroll container is neutralized so this is the single scroller.
  contentShell: 'flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--panel-bg)]',
  scrollBody: 'flex-1 overflow-auto pt-6 px-7.5 pb-10',
  // Doc: title + editor share this scroll container so the title scrolls with the content.
  docScroll: 'flex-1 min-h-0 overflow-y-auto flex flex-col',
  // Doc: title mirrors the editor column via the shared constants (inline style below).
  docTitle: 'flex-none w-full mx-auto pt-7',
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
  // The list is paginated, so a deep-linked / searched doc may be outside it — useOpenDoc
  // fetches it individually before we declare it missing.
  const { doc: openDoc, isPending } = useOpenDoc(selDoc, docs);

  if (!openDoc && isPending) {
    return (
      <main className={styles.contentShell}>
        <PageLoader />
      </main>
    );
  }

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
  const isDoc = openDoc.type === 'DOC';
  // Docs center a readable column unless the page's full-width setting is on (Page actions →
  // Full width). Sheets/whiteboards always fill the width.
  const docFullWidth = isDoc && openDoc.fullWidth;

  let editor;
  if (openDoc.type === 'SHEET') {
    editor = <SheetEditor key={openDocId} docId={openDocId} />;
  } else if (openDoc.type === 'WHITEBOARD') {
    editor = <WhiteboardEditor key={openDocId} docId={openDocId} />;
  } else {
    editor = (
      <DocEditor key={openDocId} docId={openDocId} canEdit={canEdit} fullWidth={docFullWidth} />
    );
  }

  const titleNode = (
    <PageTitle workspaceId={ctx.workspaceId} docId={openDocId} title={pageTitle} canEdit={canEdit} />
  );

  return (
    <main className={styles.contentShell}>
      {isDoc ? (
        // Doc: title + editor share one scroll container so the title scrolls with the content.
        // Keyed so scroll position (and the editor) resets per document.
        <div key={openDocId} className={styles.docScroll}>
          <div
            className={styles.docTitle}
            style={{
              // Full-width setting drops the 900px cap; the side inset stays so the title keeps
              // aligning with the editor's text.
              maxWidth: docFullWidth ? '100%' : DOC_COLUMN_WIDTH,
              paddingLeft: DOC_TEXT_INSET,
              paddingRight: DOC_TEXT_INSET,
            }}
          >
            {titleNode}
          </div>
          <Suspense fallback={<PageLoader />}>{editor}</Suspense>
        </div>
      ) : (
        // Sheet/whiteboard: fixed title over the editor (it scrolls/pans itself).
        <>
          <div className={styles.sheetTitle}>{titleNode}</div>
          <Suspense fallback={<PageLoader />}>{editor}</Suspense>
        </>
      )}
    </main>
  );
}
