import { Suspense, lazy } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { PageSpinner } from '../../components/Spinner';
import {
  useCreateDocument,
  useCreateFolder,
  useDocuments,
  useFolders,
  useSetDocumentVisibility,
} from '../../hooks/usePages';
import { buildPages } from './pagesModel';

// The editor bundle is large — load it only when a document is opened.
const DocEditor = lazy(() => import('./DocEditor').then((m) => ({ default: m.DocEditor })));
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { wsAtLeast } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { useWorkspaceCtx } from './WorkspaceLayout';

export function PagesPanel() {
  const ctx = useWorkspaceCtx();
  const ws = ctx.workspaceId;
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selDoc = params.get('doc');
  const selFolder = params.get('folder');

  const { data: docs = [], isLoading } = useDocuments(ws);
  const { data: folders = [] } = useFolders(ws);
  const createDoc = useCreateDocument();
  const createFolder = useCreateFolder();
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
            <span className="cur">📄 Pages</span>
          </div>
        </div>
        <PageSpinner />
      </main>
    );
  }

  // ---------- Reader (a doc is selected) ----------
  if (selDoc) {
    const doc = docs.find((d) => d.id === selDoc);
    const back = () => navigate(`/w/${ws}${doc?.folderId ? `?folder=${doc.folderId}` : ''}`);
    if (!doc) {
      return (
        <main className="ws-main">
          <div className="ws-crumbbar">
            <div className="ws-crumbs">
              <span role="button" onClick={() => navigate(`/w/${ws}`)}>
                {ctx.name}
              </span>
              <span className="sep">/</span>
              <span className="cur">Document</span>
            </div>
          </div>
          <div className="ws-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState glyph="🔍" glyphStyle={{ background: 'var(--surface-secondary-enabled)' }} title="Document not found">
              It may have been moved or deleted.
            </EmptyState>
          </div>
        </main>
      );
    }
    const canManage = ctx.isAdmin || doc.owner.id === me?.id;
    return (
      <main className="ws-main">
        <div className="ws-docbar">
          <div className="ws-doc-title">
            <span className="ws-doc-crumb" role="button" onClick={back}>
              {ctx.name} /{' '}
            </span>
            <span className="tw-emoji">{doc.icon || '📄'}</span>
            <span className="ws-doc-nm">{doc.title}</span>
          </div>
          <div className="ws-doc-people" style={{ gap: 8 }}>
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

  // ---------- List (a folder or the root is selected) ----------
  const model = buildPages(folders, docs);
  const folder = selFolder ? folders.find((f) => f.id === selFolder) : undefined;
  const listDocs = selFolder ? model.docsByFolder.get(selFolder) ?? [] : model.rootDocs;
  const title = folder ? folder.name : 'All pages';
  const icon = folder ? folder.icon || '📁' : '📄';

  const newDoc = () =>
    createDoc.mutate(
      { workspaceId: ws, folderId: selFolder ?? undefined },
      { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) },
    );
  const newFolder = () => createFolder.mutate({ workspaceId: ws, parentId: selFolder ?? undefined, name: 'New folder' });

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span role="button" onClick={() => navigate(`/w/${ws}`)}>
            {ctx.name}
          </span>
          <span className="sep">/</span>
          <span className="cur">
            {icon} {title}
          </span>
        </div>
        {canCreate && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" icon="FolderOutlined" onClick={newFolder} disabled={createFolder.isPending}>
              New folder
            </Button>
            <Button size="sm" variant="primary" icon="AddOutlined" onClick={newDoc} disabled={createDoc.isPending}>
              New doc
            </Button>
          </div>
        )}
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>
            {icon}
          </span>
          <div>
            <h1>{title}</h1>
            <div className="sub">
              {listDocs.length} {listDocs.length === 1 ? 'doc' : 'docs'} · in {ctx.name}
            </div>
          </div>
        </div>

        {listDocs.length === 0 ? (
          <EmptyState
            glyph="📄"
            glyphStyle={{ background: 'var(--surface-secondary-enabled)' }}
            title="No documents here yet"
            actions={
              canCreate ? (
                <Button variant="primary" icon="AddOutlined" onClick={newDoc}>
                  New doc
                </Button>
              ) : undefined
            }
          >
            {canCreate ? 'Create the first one.' : 'You have read access — an editor can add documents.'}
          </EmptyState>
        ) : (
          <div className="tbl ws-docs-tbl">
            <div className="thead">
              <div>Name</div>
              <div>Owner</div>
              <div>Edited</div>
              <div>Sharing</div>
            </div>
            {listDocs.map((d) => (
              <div key={d.id} className="trow" role="button" onClick={() => navigate(`/w/${ws}?doc=${d.id}`)}>
                <div className="cell-main">
                  <span className="tw-emoji big">{d.icon || '📄'}</span>
                  <div>
                    <div className="nm">{d.title}</div>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar person={{ name: d.owner.name, color: d.owner.color }} size={22} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.owner.name.split(' ')[0]}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{relativeTime(d.updatedAt)}</div>
                <div>
                  <span className="lock-note">
                    <Icon name={d.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'} size={14} />
                    {d.visibility === 'PUBLIC' ? 'Public' : 'Private'}
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
