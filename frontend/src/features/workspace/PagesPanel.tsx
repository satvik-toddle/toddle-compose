import { Suspense, lazy } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { PageSpinner } from '../../components/Spinner';
import { useCreateDocument, useDocuments, useSetDocumentVisibility } from '../../hooks/usePages';
import { buildDocTree } from './pagesModel';

// The editor bundle is large — load it only when a page is opened.
const DocEditor = lazy(() => import('./DocEditor').then((m) => ({ default: m.DocEditor })));
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { wsAtLeast } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { useWorkspaceCtx } from './WorkspaceLayout';

// Coda-style: everything is a page (document). The home view lists top-level
// pages; opening a page shows its editor and lets you add sub-pages. Nesting is
// by document parentId (see PagesTree) — there is no separate folder view.
export function PagesPanel() {
  const ctx = useWorkspaceCtx();
  const ws = ctx.workspaceId;
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selDoc = params.get('doc');

  const { data: docs = [], isLoading } = useDocuments(ws);
  const createDoc = useCreateDocument();
  const setVisibility = useSetDocumentVisibility();
  const openModal = useUiStore((s) => s.openModal);

  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  if (isLoading) {
    return (
      <main className="ws-main">
        <div className="ws-crumbbar">
          <div className="ws-crumbs">
            <span>{ctx.name}</span>
            <span className="sep">/</span>
            <span className="cur">
              <Icon name="FileOutlined" size={14} muted /> Pages
            </span>
          </div>
        </div>
        <PageSpinner />
      </main>
    );
  }

  // ---------- Reader (a page is open) ----------
  if (selDoc) {
    const doc = docs.find((d) => d.id === selDoc);
    // Go up to the parent page if this is a sub-page, otherwise back to the home list.
    const back = () => navigate(`/w/${ws}${doc?.parentId ? `?doc=${doc.parentId}` : ''}`);
    if (!doc) {
      return (
        <main className="ws-main">
          <div className="ws-crumbbar">
            <div className="ws-crumbs">
              <span role="button" onClick={() => navigate(`/w/${ws}`)}>
                {ctx.name}
              </span>
              <span className="sep">/</span>
              <span className="cur">Page</span>
            </div>
          </div>
          <div className="ws-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState glyph="🔍" glyphStyle={{ background: 'var(--surface-secondary-enabled)' }} title="Page not found">
              It may have been moved or deleted.
            </EmptyState>
          </div>
        </main>
      );
    }
    const canManage = ctx.isAdmin || doc.owner.id === me?.id;
    const addSubPage = () =>
      createDoc.mutate(
        { workspaceId: ws, parentId: doc.id, title: 'Untitled' },
        { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) },
      );
    return (
      <main className="ws-main">
        <div className="ws-docbar">
          <div className="ws-doc-title">
            <span className="ws-doc-crumb" role="button" onClick={back}>
              {ctx.name} /{' '}
            </span>
            <span className="tw-emoji">
              <Icon name="FileOutlined" size={16} muted />
            </span>
            <span className="ws-doc-nm">{doc.title}</span>
          </div>
          <div className="ws-doc-people" style={{ gap: 8 }}>
            {canCreate && (
              <Button size="sm" variant="ghost" icon="AddOutlined" disabled={createDoc.isPending} onClick={addSubPage}>
                Sub-page
              </Button>
            )}
            {canManage && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="PencilOutlined"
                  onClick={() =>
                    openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title })
                  }
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={doc.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'}
                  disabled={setVisibility.isPending}
                  onClick={() =>
                    setVisibility.mutate({
                      workspaceId: ws,
                      id: doc.id,
                      visibility: doc.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
                    })
                  }
                >
                  {doc.visibility === 'PUBLIC' ? 'Public' : 'Private'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="DeleteOutlined"
                  onClick={() =>
                    openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title })
                  }
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
        <Suspense fallback={<PageSpinner />}>
          <DocEditor key={doc.id} docId={doc.id} canEdit={wsAtLeast(ctx.role, 'EDIT')} />
        </Suspense>
      </main>
    );
  }

  // ---------- Home (top-level pages) ----------
  const { roots } = buildDocTree(docs);
  const newPage = () =>
    createDoc.mutate(
      { workspaceId: ws, title: 'Untitled' },
      { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) },
    );

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span role="button" onClick={() => navigate(`/w/${ws}`)}>
            {ctx.name}
          </span>
          <span className="sep">/</span>
          <span className="cur">
            <Icon name="FileOutlined" size={14} muted /> All pages
          </span>
        </div>
        {canCreate && (
          <Button size="sm" variant="primary" icon="AddOutlined" onClick={newPage} disabled={createDoc.isPending}>
            New page
          </Button>
        )}
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>
            <Icon name="FileOutlined" size={24} muted />
          </span>
          <div>
            <h1>All pages</h1>
            <div className="sub">
              {roots.length} {roots.length === 1 ? 'page' : 'pages'} · in {ctx.name}
            </div>
          </div>
        </div>

        {roots.length === 0 ? (
          <EmptyState
            glyph="📄"
            glyphStyle={{ background: 'var(--surface-secondary-enabled)' }}
            title="No pages yet"
            actions={
              canCreate ? (
                <Button variant="primary" icon="AddOutlined" onClick={newPage}>
                  New page
                </Button>
              ) : undefined
            }
          >
            {canCreate ? 'Create the first one.' : 'You have read access — an editor can add pages.'}
          </EmptyState>
        ) : (
          <div className="tbl ws-docs-tbl">
            <div className="thead">
              <div>Name</div>
              <div>Owner</div>
              <div>Edited</div>
              <div>Sharing</div>
            </div>
            {roots.map((n) => (
              <div key={n.doc.id} className="trow" role="button" onClick={() => navigate(`/w/${ws}?doc=${n.doc.id}`)}>
                <div className="cell-main">
                  <span className="tw-emoji big">
                    <Icon name="FileOutlined" size={20} muted />
                  </span>
                  <div>
                    <div className="nm">{n.doc.title}</div>
                    {n.children.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {n.children.length} sub-page{n.children.length === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar person={{ name: n.doc.owner.name, color: n.doc.owner.color }} size={22} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.doc.owner.name.split(' ')[0]}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{relativeTime(n.doc.updatedAt)}</div>
                <div>
                  <span className="lock-note">
                    <Icon name={n.doc.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'} size={14} />
                    {n.doc.visibility === 'PUBLIC' ? 'Public' : 'Private'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
