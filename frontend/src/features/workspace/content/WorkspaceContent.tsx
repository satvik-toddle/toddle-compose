import { useSearchParams } from 'react-router-dom';
import { PageLoader } from '../../../components/Loader';
import { useDocuments } from '../../../hooks/usePages';
import { useWorkspaceCtx } from '../WorkspaceLayout';
import { DocHistoryView, useHistoryMode } from '../history';
import { AllPagesView } from './AllPagesView';
import { PageView } from './PageView';

// Coda-style: every page is a document. The breadcrumb + page actions (Share /
// Rename / Delete / Sub-page) and "New page" all live in the single top toolbar
// (see WorkspaceTopbar) — this region renders ONLY content: the editor for an
// open page, or the top-level pages list for the workspace home.
export function WorkspaceContent() {
  const ctx = useWorkspaceCtx();
  const ws = ctx.workspaceId;
  const [params] = useSearchParams();
  const selDoc = params.get('doc');
  const history = useHistoryMode();

  const { data: docs = [], isLoading } = useDocuments(ws);

  if (isLoading) {
    return (
      <main className="ws-main">
        <PageLoader />
      </main>
    );
  }

  if (selDoc) {
    // History mode only applies to DOC pages (see DocActions); otherwise fall
    // through to the normal editor view.
    const openDoc = docs.find((d) => d.id === selDoc);
    if (history.active && openDoc?.type === 'DOC') {
      return <DocHistoryView doc={openDoc} />;
    }
    return <PageView ctx={ctx} docs={docs} selDoc={selDoc} />;
  }

  return <AllPagesView ctx={ctx} docs={docs} />;
}
