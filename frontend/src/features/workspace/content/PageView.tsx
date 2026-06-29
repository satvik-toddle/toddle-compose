import { Suspense, lazy } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import { PageLoader } from '../../../components/Loader';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { PageTitle } from './PageTitle';
import s from './content.module.scss';

// The editor bundle is large — load it only when a page is opened.
const DocEditor = lazy(() => import('../DocEditor').then((m) => ({ default: m.DocEditor })));

// Reader: a single page is open (via the `?doc=` param). Renders the editable
// title + the lazy editor, or a "not found" state for a stale/deleted id.
export function PageView({
  ctx,
  docs,
  selDoc,
}: {
  ctx: WorkspaceCtx;
  docs: DocumentDto[];
  selDoc: string;
}) {
  const ws = ctx.workspaceId;
  const doc = docs.find((d) => d.id === selDoc);
  if (!doc) {
    return (
      <main className="ws-main">
        <div
          className="ws-scroll"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <EmptyState
            glyph="🔍"
            glyphStyle={{ background: 'var(--surface-secondary-enabled)' }}
            title="Page not found"
          >
            It may have been moved or deleted.
          </EmptyState>
        </div>
      </main>
    );
  }
  const canEdit = wsAtLeast(ctx.role, 'EDIT');
  return (
    <main className="ws-main">
      <div className={s.wsDocTitlewrap}>
        <PageTitle workspaceId={ws} docId={doc.id} title={doc.title} canEdit={canEdit} />
      </div>
      <Suspense fallback={<PageLoader />}>
        <DocEditor key={doc.id} docId={doc.id} canEdit={canEdit} />
      </Suspense>
    </main>
  );
}
