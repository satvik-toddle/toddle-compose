import { useNavigate } from 'react-router-dom';
import { EmptyState, Button } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { MultipleUsersOutlined } from '@toddle-edu/ds-icons';
import { PageLoader } from '../../components/Loader';
import { Icon, type IconName } from '../../components/Icon';
import { useAllSharedDocuments } from '../../hooks/useShareLink';
import { pageTypeIcon } from '../workspace/pageTypes';
import { WS_ROLE_META } from '../../lib/roles';
import type { DocumentDto } from '../../types/api';
import { PagesListView, type PageRow, type TableHeader } from '../workspace/content/PagesListView';

const HEADERS: TableHeader[] = [
  { key: 'name', value: 'Name' },
  { key: 'workspace', value: 'Workspace' },
  { key: 'permission', value: 'Permission' },
  { key: 'open', value: '' },
];

// Absolute date + time the grant was created (when this user was added to the doc).
function addedAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const cell = {
  nameWrap: 'flex flex-col',
  nameTitle: 'text-body-s font-medium text-primary truncate',
  nameSub: 'text-body-xs text-secondary',
};

export function SharedWithMeView() {
  const navigate = useNavigate();
  const { data: docs = [], isLoading } = useAllSharedDocuments();

  const open = (doc: DocumentDto) => {
    const wsId = doc.workspace?.id ?? doc.workspaceId;
    navigate(`/w/${wsId}?doc=${doc.id}`);
  };

  const toRow = (doc: DocumentDto): PageRow => {
    const PageIcon = pageTypeIcon(doc.type);
    const meta = doc.myRole ? WS_ROLE_META[doc.myRole] : null;
    return {
      id: doc.id,
      rowData: [
        {
          key: 'name',
          value: (
            <span className={cell.nameWrap}>
              <span className={cell.nameTitle}>{doc.title || 'Untitled'}</span>
              <span className={cell.nameSub}>Added {addedAt(doc.sharedAt)}</span>
            </span>
          ),
          prefix: <PageIcon size="xx-small" variant="subtle" />,
        },
        { key: 'workspace', value: doc.workspace?.name ?? '—' },
        {
          key: 'permission',
          value: meta?.label ?? '—',
          prefix: meta ? <Icon name={meta.icon as IconName} size={14} muted /> : undefined,
        },
        {
          key: 'open',
          value: (
            <Button dsVersion="2.0" variant="neutral" type="outlined" size="small" shouldStopPropagation onClick={() => open(doc)}>
              Open
            </Button>
          ),
        },
      ],
    };
  };

  if (isLoading) return <PageLoader />;

  return (
    <PagesListView<DocumentDto>
      title="Shared with me"
      icon={<MultipleUsersOutlined size="x-small" variant="subtle" />}
      docs={docs}
      onOpenDoc={(id) => {
        const doc = docs.find((d) => d.id === id);
        if (doc) open(doc);
      }}
      headers={HEADERS}
      toRow={toRow}
      emptyState={
        <EmptyState
          dsVersion="2.0"
          illustration={EmptyStateIllustrations.NoFoldersIllustration}
          title="Nothing shared with you yet"
          subtitle="Pages people share with you across workspaces will appear here."
        />
      }
    />
  );
}
