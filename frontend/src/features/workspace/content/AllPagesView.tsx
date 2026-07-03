import { useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { AddOutlined, PageFoldPortraitOutlined } from '@toddle-edu/ds-icons';
import { useCreateDocument } from '../../../hooks/usePages';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto, DocumentType } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { DEFAULT_PAGE_TITLE } from '../constants';
import { buildDocTree } from '../pagesModel';
import { CreatePageDropdown } from '../CreatePageDropdown';
import { PagesListView } from './PagesListView';

type AllPagesViewProps = {
  ctx: WorkspaceCtx;
  docs: DocumentDto[];
};

// Workspace home: the top-level pages list (a page with children is a "folder").
export function AllPagesView({ ctx, docs }: Readonly<AllPagesViewProps>) {
  const workspaceId = ctx.workspaceId;
  const navigate = useNavigate();
  const createDoc = useCreateDocument();
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  const { roots } = buildDocTree(docs);
  const openDoc = (id: string | number) => navigate(`/w/${workspaceId}?doc=${id}`);
  const newPage = (type?: DocumentType) =>
    createDoc.mutate(
      { workspaceId, title: DEFAULT_PAGE_TITLE, type },
      { onSuccess: (created) => openDoc(created.id) },
    );

  return (
    <PagesListView
      title="All pages"
      icon={<PageFoldPortraitOutlined size="x-small" variant="subtle" />}
      docs={roots.map(({ doc }) => doc)}
      onOpenDoc={openDoc}
      emptyState={
        <EmptyState
          dsVersion="2.0"
          illustration={EmptyStateIllustrations.NoFoldersIllustration}
          title="No pages yet"
          subtitle={
            canCreate ? 'Create the first one.' : 'You have read access — an editor can add pages.'
          }
          primaryButton={
            canCreate ? (
              <CreatePageDropdown onCreate={newPage}>
                <span className="inline-flex">
                  <Button variant="primary" type="fill" icon={<AddOutlined />}>
                    New page
                  </Button>
                </span>
              </CreatePageDropdown>
            ) : undefined
          }
        />
      }
    />
  );
}
