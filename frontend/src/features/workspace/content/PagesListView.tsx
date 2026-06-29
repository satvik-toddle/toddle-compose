import type { ReactNode } from 'react';
import { Avatar, Table } from '@toddle-edu/ds-web';
import { PageFoldPortraitOutlined, GlobeOutlined, LockOutlined } from '@toddle-edu/ds-icons';
import { dsAvatarColor } from '../../../lib/dsAvatar';
import { firstName, relativeTime } from '../../../lib/time';
import type { DocumentDto } from '../../../types/api';

const styles = {
  contentShell: 'flex-1 min-w-0 flex flex-col bg-[var(--panel-bg)]',
  // Fills the panel height; the table inside scrolls, not the whole page.
  body: 'flex-1 min-h-0 flex flex-col pt-6 px-7.5 pb-10',
  header: 'flex items-center gap-3.5 mb-[18px]',
  headerIcon: 'flex items-center justify-center w-7.5 h-7.5 rounded-2 bg-surface-tertiary-enabled',
  headerTitle: 'm-0 text-heading-3 text-primary',
  // Outer border + the bounded scroll area for the table (showBorder would add
  // vertical column lines); the table's own header stays fixed while rows scroll.
  tableWrap: 'flex-1 min-h-0 overflow-auto border border-secondary rounded-2',
  // Fill the space under the header and center the empty illustration in it.
  emptyWrap: 'flex-1 min-h-0 flex items-center justify-center',
};

const TABLE_HEADERS = [
  { key: 'name', value: 'Name' },
  { key: 'owner', value: 'Owner' },
  { key: 'edited', value: 'Edited' },
  { key: 'sharing', value: 'Sharing' },
];

function toRow(doc: DocumentDto) {
  return {
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
  };
}

type PagesListViewProps = {
  title: string;
  icon: ReactNode;
  docs: DocumentDto[];
  onOpenDoc: (id: string | number) => void;
  emptyState: ReactNode;
};

// Shared shell for the workspace page lists (All pages, Starred): a titled header
// over a bounded, fixed-header table — or the caller's empty state when there are none.
export function PagesListView({
  title,
  icon,
  docs,
  onOpenDoc,
  emptyState,
}: Readonly<PagesListViewProps>) {
  return (
    <main className={styles.contentShell}>
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.headerIcon}>{icon}</span>
          <h1 className={styles.headerTitle}>{title}</h1>
        </div>

        {docs.length === 0 ? (
          <div className={styles.emptyWrap}>{emptyState}</div>
        ) : (
          <div className={styles.tableWrap}>
            <Table
              dsVersion="2.0"
              headers={TABLE_HEADERS}
              data={docs.map(toRow)}
              onRowClick={onOpenDoc}
              isHeaderFixed
            />
          </div>
        )}
      </div>
    </main>
  );
}
