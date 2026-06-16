import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useCreateDocument, useDocuments } from '../../hooks/usePages';
import { buildDocTree, type TreeDoc } from './pagesModel';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { wsAtLeast } from '../../lib/roles';
import { cn } from '../../lib/cn';
import type { WorkspaceCtx } from './WorkspaceLayout';

// Coda-style page tree: every row is a page (document); a page that has child
// pages can expand. Nesting is by document parentId — no separate folder type.
export function PagesTree({ ctx }: { ctx: WorkspaceCtx }) {
  const ws = ctx.workspaceId;
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selDoc = params.get('doc');

  const { data: docs = [], isLoading } = useDocuments(ws);
  const createDoc = useCreateDocument();
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

  const { roots, isEmpty } = buildDocTree(docs);
  const canManage = (ownerId: string) => ctx.isAdmin || me?.id === ownerId;

  const selectDoc = (id: string) => navigate(`/w/${ws}?doc=${id}`);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const expand = (id: string) =>
    setCollapsed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  const newRootPage = () =>
    createDoc.mutate({ workspaceId: ws, title: 'Untitled' }, { onSuccess: (d) => selectDoc(d.id) });

  const PageMenu = ({ node, manage }: { node: TreeDoc; manage: boolean }) => (
    <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
      {canCreate && (
        <div
          className="fm-row"
          role="button"
          onClick={() => {
            setMenuId(null);
            expand(node.doc.id);
            createDoc.mutate(
              { workspaceId: ws, parentId: node.doc.id, title: 'Untitled' },
              { onSuccess: (d) => selectDoc(d.id) },
            );
          }}
        >
          <Icon name="AddOutlined" size={14} muted />
          Add sub-page
        </div>
      )}
      {manage && (
        <div
          className="fm-row"
          role="button"
          onClick={() => {
            setMenuId(null);
            openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: node.doc.id, name: node.doc.title });
          }}
        >
          <Icon name="PencilOutlined" size={14} muted />
          Rename
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
              openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId: ws, id: node.doc.id, name: node.doc.title });
            }}
          >
            <Icon name="DeleteOutlined" size={14} red />
            Delete
          </div>
        </>
      )}
    </div>
  );

  const PageNode = ({ node, depth }: { node: TreeDoc; depth: number }) => {
    const hasKids = node.children.length > 0;
    const open = !collapsed.has(node.doc.id);
    const manage = canManage(node.doc.owner.id);
    return (
      <>
        <div
          className={cn('tree-row doc', selDoc === node.doc.id && 'active', menuId === node.doc.id && 'menu-open')}
          style={{ paddingLeft: 8 + depth * 15 }}
          role="button"
          onClick={() => selectDoc(node.doc.id)}
        >
          <span
            className="chev-wrap"
            // Keep the chevron column for leaf pages too, so icons stay aligned.
            style={{ display: 'inline-flex', visibility: hasKids ? 'visible' : 'hidden' }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.doc.id);
            }}
          >
            <Icon name="ChevronRightOutlined" size={14} muted className={cn('chev', open && 'open')} />
          </span>
          <span className="tw-emoji">
            <Icon name="FileOutlined" size={16} muted />
          </span>
          <span className="tw-lbl">{node.doc.title}</span>
          {(canCreate || manage) && (
            <button
              className="tw-more"
              onClick={(e) => {
                e.stopPropagation();
                setMenuId((m) => (m === node.doc.id ? null : node.doc.id));
              }}
            >
              <Icon name="DotsHorizontalOutlined" size={14} muted />
            </button>
          )}
          {menuId === node.doc.id && <PageMenu node={node} manage={manage} />}
        </div>
        {open && hasKids && node.children.map((c) => <PageNode key={c.doc.id} node={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <>
      <div className="ws-nav-grp">
        Pages
        {canCreate && (
          <button className="grp-add" title="New page" onClick={newRootPage}>
            <Icon name="AddOutlined" size={14} muted />
          </button>
        )}
      </div>
      <div className="ws-tree">
        {isLoading ? (
          <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
        ) : isEmpty ? (
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
          roots.map((n) => <PageNode key={n.doc.id} node={n} depth={0} />)
        )}
      </div>
    </>
  );
}
