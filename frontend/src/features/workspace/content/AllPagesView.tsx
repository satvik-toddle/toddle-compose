import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Table } from '@toddle-edu/ds-web';
import {
  AddOutlined,
  PageFoldPortraitOutlined,
  GlobeOutlined,
  LockOutlined,
} from '@toddle-edu/ds-icons';
import { EmptyState } from '../../../components/EmptyState';
import { useCreateDocument } from '../../../hooks/usePages';
import { dsAvatarColor } from '../../../lib/dsAvatar';
import { firstName, relativeTime } from '../../../lib/time';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { DEFAULT_PAGE_TITLE } from '../constants';
import { buildDocTree } from '../pagesModel';

const styles = {
  contentShell: 'flex-1 min-w-0 flex flex-col bg-[var(--panel-bg)]',
  // Fills the panel height; the table inside scrolls, not the whole page.
  body: 'flex-1 min-h-0 flex flex-col pt-6 px-7.5 pb-10',
  header: 'flex items-center gap-3.5 mb-[18px]',
  headerIcon:
    'flex items-center justify-center w-7.5 h-7.5 rounded-2 bg-surface-tertiary-enabled',
  headerTitle: 'm-0 text-heading-3 text-primary',
  // Outer border + the bounded scroll area for the table (showBorder would add
  // vertical column lines); the table's own header stays fixed while rows scroll.
  tableWrap: 'flex-1 min-h-0 overflow-auto border border-secondary rounded-2',
};

const TABLE_HEADERS = [
  { key: 'name', value: 'Name' },
  { key: 'owner', value: 'Owner' },
  { key: 'edited', value: 'Edited' },
  { key: 'sharing', value: 'Sharing' },
];

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
  const newPage = () =>
    createDoc.mutate(
      { workspaceId, title: DEFAULT_PAGE_TITLE },
      { onSuccess: (created) => openDoc(created.id) },
    );

  const rows = roots.map(({ doc }) => ({
    id: doc.id,
    rowData: [
      {
        key: 'name',
        value: doc.title,
        prefix: <PageFoldPortraitOutlined size="xx-small" variant="subtle" />,
      },
      {
        key: 'owner',
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
      { key: 'edited', value: <span className="tabular-nums">{relativeTime(doc.updatedAt)}</span> },
      {
        key: 'sharing',
        value: doc.visibility === 'PUBLIC' ? 'Public' : 'Private',
        prefix:
          doc.visibility === 'PUBLIC' ? (
            <GlobeOutlined size="xxx-small" variant="subtle" />
          ) : (
            <LockOutlined size="xxx-small" variant="subtle" />
          ),
      },
    ],
  }));

  return (
    <main className={styles.contentShell}>
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <PageFoldPortraitOutlined size="x-small" variant="subtle" />
          </span>
          <h1 className={styles.headerTitle}>All pages</h1>
        </div>

        {roots.length === 0 ? (
          <EmptyState
            glyph="📄"
            title="No pages yet"
            actions={
              canCreate ? (
                <Button
                  dsVersion="2.0"
                  variant="primary"
                  type="fill"
                  icon={<AddOutlined />}
                  onClick={newPage}
                >
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
          <div className={styles.tableWrap}>
            <Table
              dsVersion="2.0"
              headers={TABLE_HEADERS}
              data={rows}
              onRowClick={openDoc}
              isHeaderFixed
            />
          </div>
        )}
      </div>
    </main>
  );
}
