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
    // useHistoryMode already resolved the open DOC (history.active ⇒ it's a DOC), so reuse it.
    if (history.active && history.openDoc) {
      return <DocHistoryView doc={history.openDoc} workspaceId={ws} />;
    }
    return <PageView ctx={ctx} docs={docs} selDoc={selDoc} />;
  }

  return <AllPagesView ctx={ctx} docs={docs} />;
}
