import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ActionMenu } from '../../components/ActionMenu';
import { Loader } from '../../components/Loader';
import { useCreateDocument, useDocuments } from '../../hooks/usePages';
import { buildDocTree, type TreeDoc } from './pagesModel';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { wsAtLeast } from '../../lib/roles';
import { cn } from '../../lib/cn';
import type { WorkspaceCtx } from './WorkspaceLayout';
import s from './PagesTree.module.scss';

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

  // Pages start collapsed; this set tracks the ones that are explicitly expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  const { roots, isEmpty } = buildDocTree(docs);
  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const canManage = (ownerId: string) => ctx.isAdmin || me?.id === ownerId;

  // When a page is deep-linked (?doc=…), expand its ancestor spine on load so the
  // selected page is revealed in the otherwise-collapsed tree. We only ever add to
  // the expanded set, so manual collapses by the user aren't fought.
  useEffect(() => {
    if (!selDoc) return;
    const ids: string[] = [];
    const seen = new Set<string>();
    let cur: string | null | undefined = selDoc;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ids.push(cur); // expand the doc itself too, so its sub-pages show
      cur = byId.get(cur)?.parentId ?? null;
    }
    setExpanded((prev) => {
      const n = new Set(prev);
      for (const id of ids) n.add(id);
      return n;
    });
  }, [selDoc, byId]);

  const selectDoc = (id: string) => navigate(`/w/${ws}?doc=${id}`);
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const expand = (id: string) =>
    setExpanded((s) => (s.has(id) ? s : new Set(s).add(id)));

  const newRootPage = () =>
    createDoc.mutate({ workspaceId: ws, title: 'Untitled' }, { onSuccess: (d) => selectDoc(d.id) });

  const PageNode = ({ node, depth }: { node: TreeDoc; depth: number }) => {
    const hasKids = node.children.length > 0;
    const open = expanded.has(node.doc.id);
    const manage = canManage(node.doc.owner.id);
    return (
      <>
        <div
          className={cn(s.treeRow, s.doc, selDoc === node.doc.id && s.active)}
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
            <Icon name="ChevronRightOutlined" size={14} muted className={cn(s.chev, open && s.open)} />
          </span>
          <span className="tw-emoji">
            <Icon name="FileOutlined" size={16} muted />
          </span>
          <span className={s.twLbl}>{node.doc.title}</span>
          {(canCreate || manage) && (
            <span className="tw-more-wrap" onClick={(e) => e.stopPropagation()}>
              <ActionMenu
                placement="bottomRight"
                trigger={
                  <button className={s.twMore}>
                    <Icon name="DotsHorizontalOutlined" size={14} muted />
                  </button>
                }
                items={[
                  ...(canCreate
                    ? [
                        {
                          key: 'subpage',
                          label: 'Add sub-page',
                          icon: 'AddOutlined' as const,
                          onSelect: () => {
                            expand(node.doc.id);
                            createDoc.mutate(
                              { workspaceId: ws, parentId: node.doc.id, title: 'Untitled' },
                              { onSuccess: (d) => selectDoc(d.id) },
                            );
                          },
                        },
                      ]
                    : []),
                  ...(manage
                    ? [
                        {
                          key: 'rename',
                          label: 'Rename',
                          icon: 'PencilOutlined' as const,
                          onSelect: () =>
                            openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: node.doc.id, name: node.doc.title }),
                        },
                        {
                          key: 'delete',
                          label: 'Delete',
                          icon: 'DeleteOutlined' as const,
                          danger: true,
                          dividerBefore: true,
                          onSelect: () =>
                            openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId: ws, id: node.doc.id, name: node.doc.title }),
                        },
                      ]
                    : []),
                ]}
              />
            </span>
          )}
        </div>
        {open && hasKids && (
          <>
            {node.children.map((c) => <PageNode key={c.doc.id} node={c} depth={depth + 1} />)}
            {/* Coda-style "New page" row at the bottom of an expanded parent's children */}
            {canCreate && (
              <div
                className={s.newPageRow}
                // align the + with the child page-icon column (chevron 14 + 7 gap)
                style={{ paddingLeft: 8 + (depth + 1) * 15 + 21 }}
                role="button"
                onClick={() => {
                  expand(node.doc.id);
                  createDoc.mutate(
                    { workspaceId: ws, parentId: node.doc.id, title: 'Untitled' },
                    { onSuccess: (d) => selectDoc(d.id) },
                  );
                }}
              >
                <Icon name="AddOutlined" size={16} muted />
                New page
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <>
      <div className={s.wsNavGrp}>Pages</div>
      <div className={s.wsTree}>
        {isLoading ? (
          <div style={{ padding: '8px 9px' }}>
              <Loader size={20} />
            </div>
        ) : (
          <>
            {!isEmpty && roots.map((n) => <PageNode key={n.doc.id} node={n} depth={0} />)}
            {isEmpty && !canCreate && (
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
            )}
            {/* Coda-style "New page" row at the bottom of the tree */}
            {canCreate && (
              <div className={s.newPageRow} style={{ paddingLeft: 8 + 21 }} role="button" onClick={newRootPage}>
                <Icon name="AddOutlined" size={16} muted />
                New page
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
