import { useNavigate } from 'react-router-dom';
import { Avatar, EmptyState } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { MultipleUsersOutlined } from '@toddle-edu/ds-icons';
import { PageLoader } from '../../../components/Loader';
import { Icon, type IconName } from '../../../components/Icon';
import { useSharedDocuments } from '../../../hooks/usePages';
import { useWorkspaceCtx } from '../context';
import { pageTypeIcon } from '../pageTypes';
import { dsAvatarColor } from '../../../lib/dsAvatar';
import { firstName, relativeTime } from '../../../lib/time';
import { WS_ROLE_META } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import { PagesListView, type PageRow, type TableHeader } from './PagesListView';

const HEADERS: TableHeader[] = [
  { key: 'name', value: 'Name' },
  { key: 'sharedBy', value: 'Shared by' },
  { key: 'permission', value: 'Permission' },
  { key: 'shared', value: 'Shared' },
];

function toRow(doc: DocumentDto): PageRow {
  const PageIcon = pageTypeIcon(doc.type);
  const meta = doc.myRole ? WS_ROLE_META[doc.myRole] : null;
  return {
    id: doc.id,
    rowData: [
      {
        key: 'name',
        value: doc.title,
        prefix: <PageIcon size="xx-small" variant="subtle" />,
      },
      {
        key: 'sharedBy',
        value: firstName(doc.owner.name),
        prefix: (
          <Avatar
            dsVersion="2.0"
            name={doc.owner.name}
            color={dsAvatarColor(doc.owner.color)}
            size="small"
            shape="circle"
          />
        ),
      },
      {
        key: 'permission',
        value: meta?.label ?? '—',
        prefix: meta ? <Icon name={meta.icon as IconName} size={14} muted /> : undefined,
      },
      {
        key: 'shared',
        value: (
          <span className="tabular-nums">{doc.sharedAt ? relativeTime(doc.sharedAt) : '—'}</span>
        ),
      },
    ],
  };
}

// Pages shared with the current user via per-page grants — flat, newest grant first.
export function SharedPagesView() {
  const { workspaceId } = useWorkspaceCtx();
  const navigate = useNavigate();
  const { data: docs = [], isLoading } = useSharedDocuments(workspaceId);

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
      title="Shared with me"
      icon={<MultipleUsersOutlined size="x-small" variant="subtle" />}
      docs={docs}
      onOpenDoc={openDoc}
      headers={HEADERS}
      toRow={toRow}
      emptyState={
        <EmptyState
          dsVersion="2.0"
          illustration={EmptyStateIllustrations.NoFoldersIllustration}
          title="No pages shared with you"
          subtitle="Pages others share with you will appear here."
        />
      }
    />
  );
}
