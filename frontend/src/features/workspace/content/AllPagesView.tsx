import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useCreateDocument } from '../../../hooks/usePages';
import { relativeTime } from '../../../lib/time';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { buildDocTree } from '../pagesModel';
import s from './content.module.scss';

// Workspace home: the top-level pages list (a page with children is a "folder").
export function AllPagesView({ ctx, docs }: { ctx: WorkspaceCtx; docs: DocumentDto[] }) {
  const ws = ctx.workspaceId;
  const navigate = useNavigate();
  const createDoc = useCreateDocument();
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  const { roots } = buildDocTree(docs);
  const newPage = () =>
    createDoc.mutate(
      { workspaceId: ws, title: 'Untitled' },
      { onSuccess: (d) => navigate(`/w/${ws}?doc=${d.id}`) },
    );

  return (
    <main className="ws-main">
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
            {canCreate
              ? 'Create the first one.'
              : 'You have read access — an editor can add pages.'}
          </EmptyState>
        ) : (
          <div className={`tbl ${s.wsDocsTbl}`}>
            <div className="thead">
              <div>Name</div>
              <div>Owner</div>
              <div>Edited</div>
              <div>Sharing</div>
            </div>
            {roots.map((n) => (
              <div
                key={n.doc.id}
                className="trow"
                role="button"
                onClick={() => navigate(`/w/${ws}?doc=${n.doc.id}`)}
              >
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
                    <Avatar
                      person={{ name: n.doc.owner.name, color: n.doc.owner.color }}
                      size={22}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {n.doc.owner.name.split(' ')[0]}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {relativeTime(n.doc.updatedAt)}
                </div>
                <div>
                  <span className="lock-note">
                    <Icon
                      name={n.doc.visibility === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined'}
                      size={14}
                    />
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
