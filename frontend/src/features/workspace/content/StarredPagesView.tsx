import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { StarOutlined } from '@toddle-edu/ds-icons';
import { PageLoader } from '../../../components/Loader';
import { useStarredDocuments } from '../../../hooks/usePages';
import { useWorkspaceCtx } from '../context';
import { PagesListView } from './PagesListView';

// The current user's starred pages — a flat list at any depth, newest interactions first.
export function StarredPagesView() {
  const { workspaceId } = useWorkspaceCtx();
  const navigate = useNavigate();
  const { data: docs = [], isLoading } = useStarredDocuments(workspaceId);

  if (isLoading) {
    return (
      <main className="ws-main">
        <PageLoader />
      </main>
    );
  }

  const openDoc = (id: string | number) => navigate(`/w/${workspaceId}?doc=${id}`);

  return (
    <PagesListView
      title="Starred pages"
      icon={<StarOutlined size="x-small" variant="subtle" />}
      docs={docs}
      onOpenDoc={openDoc}
      emptyState={
        <EmptyState
          dsVersion="2.0"
          illustration={EmptyStateIllustrations.NoFoldersIllustration}
          title="No starred pages"
          subtitle="Star a page to find it here."
        />
      }
    />
  );
}
