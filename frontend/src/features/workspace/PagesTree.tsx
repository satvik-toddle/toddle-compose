import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import {
  useCreateDocument,
  useCreateFolder,
  useDocuments,
  useFolders,
} from '../../hooks/usePages';
import { buildPages, type TreeFolder } from './pagesModel';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { wsAtLeast } from '../../lib/roles';
import { cn } from '../../lib/cn';
import type { WorkspaceCtx } from './WorkspaceLayout';
import type { DocumentDto } from '../../types/api';

export function PagesTree({ ctx }: { ctx: WorkspaceCtx }) {
  const ws = ctx.workspaceId;
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selFolder = params.get('folder');
  const selDoc = params.get('doc');

  const { data: folders = [], isLoading: lf } = useFolders(ws);
  const { data: docs = [], isLoading: ld } = useDocuments(ws);
  const createDoc = useCreateDocument();
  const createFolder = useCreateFolder();
  const openModal = useUiStore((s) => s.openModal);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuId]);

  const model = buildPages(folders, docs);
  const loading = lf || ld;

  const selectDoc = (id: string) => navigate(`/w/${ws}?doc=${id}`);
  const selectFolder = (id: string) => navigate(`/w/${ws}?folder=${id}`);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const canManageFolder = (ownerId: string) => ctx.isAdmin || me?.id === ownerId;

  const newRootFolder = () => createFolder.mutate({ workspaceId: ws, name: 'New folder' });

  const DocRow = ({ d, depth }: { d: DocumentDto; depth: number }) => (
    <div
      className={cn('tree-row doc', selDoc === d.id && 'active')}
      style={{ paddingLeft: 8 + depth * 15 }}
      role="button"
      onClick={() => selectDoc(d.id)}
    >
      <span className="tw-emoji">{d.icon || '📄'}</span>
      <span className="tw-lbl">{d.title}</span>
    </div>
  );

  const FolderMenu = ({ node, manage }: { node: TreeFolder; manage: boolean }) => (
    <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
      {manage && (
        <div
          className="fm-row"
          role="button"
          onClick={() => {
            setMenuId(null);
            openModal({ type: 'renamePage', kind: 'folder', workspaceId: ws, id: node.id, name: node.name });
          }}
        >
          <Icon name="PencilOutlined" size={14} muted />
          Rename
        </div>
      )}
      {canCreate && (
        <div
          className="fm-row"
          role="button"
          onClick={() => {
            setMenuId(null);
            createDoc.mutate(
              { workspaceId: ws, folderId: node.id },
              { onSuccess: (d) => selectDoc(d.id) },
            );
          }}
        >
          <Icon name="AddOutlined" size={14} muted />
          Add doc
        </div>
      )}
      {canCreate && (
        <div
          className="fm-row"
          role="button"
          onClick={() => {
            setMenuId(null);
            setCollapsed((s) => {
              const n = new Set(s);
              n.delete(node.id);
              return n;
            });
            createFolder.mutate({ workspaceId: ws, parentId: node.id, name: 'New folder' });
          }}
        >
          <Icon name="FolderOutlined" size={14} muted />
          Add folder
        </div>
      )}
      {manage && (
        <>
          <div className="fm-div" />
          <div
            className="fm-row danger"
            role="button"
            onClick={() => {
              setMenuId(null);
              openModal({ type: 'confirmDeletePage', kind: 'folder', workspaceId: ws, id: node.id, name: node.name });
            }}
          >
            <Icon name="DeleteOutlined" size={14} red />
            Delete
          </div>
        </>
      )}
    </div>
  );

  const FolderNode = ({ node, depth }: { node: TreeFolder; depth: number }) => {
    const open = !collapsed.has(node.id);
    const manage = canManageFolder(node.ownerId);
    return (
      <>
        <div
          className={cn('tree-row folder', selFolder === node.id && 'active', menuId === node.id && 'menu-open')}
          style={{ paddingLeft: 8 + depth * 15 }}
          role="button"
          onClick={() => selectFolder(node.id)}
        >
          <span
            className="chev-wrap"
            style={{ display: 'inline-flex' }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
          >
            <Icon name="ChevronRightOutlined" size={14} muted className={cn('chev', open && 'open')} />
          </span>
          <span className="tw-emoji">{node.icon}</span>
          <span className="tw-lbl">{node.name}</span>
          {(canCreate || manage) && (
            <button
              className="tw-more"
              onClick={(e) => {
                e.stopPropagation();
                setMenuId((m) => (m === node.id ? null : node.id));
              }}
            >
              <Icon name="DotsHorizontalOutlined" size={14} muted />
            </button>
          )}
          {menuId === node.id && <FolderMenu node={node} manage={manage} />}
        </div>
        {open && (
          <>
            {node.folders.map((f) => (
              <FolderNode key={f.id} node={f} depth={depth + 1} />
            ))}
            {node.docs.map((d) => (
              <DocRow key={d.id} d={d} depth={depth + 1} />
            ))}
          </>
        )}
      </>
    );
  };

  return (
    <>
      <div className="ws-nav-grp">
        Pages
        {canCreate && (
          <button className="grp-add" title="New folder" onClick={newRootFolder}>
            <Icon name="AddOutlined" size={14} muted />
          </button>
        )}
      </div>
      <div className="ws-tree">
        {loading ? (
          <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
        ) : model.isEmpty ? (
          <div
            style={{
              padding: '10px 9px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <Icon name="InformationOutlined" size={14} muted />
            No pages yet
          </div>
        ) : (
          <>
            {model.rootFolders.map((f) => (
              <FolderNode key={f.id} node={f} depth={0} />
            ))}
            {model.rootDocs.map((d) => (
              <DocRow key={d.id} d={d} depth={0} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
