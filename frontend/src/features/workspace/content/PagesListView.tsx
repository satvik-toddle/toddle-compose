import { useRef, type ReactElement, type ReactNode } from 'react';
import { Avatar, Table } from '@toddle-edu/ds-web';
import { pageTypeIcon } from '../pageTypes';
import { dsAvatarColor } from '../../../lib/dsAvatar';
import { firstName, relativeTime } from '../../../lib/time';
import type { DocumentDto } from '../../../types/api';

const styles = {
  contentShell: 'flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--panel-bg)]',
  body: 'flex-1 min-h-0 flex flex-col pt-6 px-7.5 pb-10', // Fills the panel; the table inside scrolls, not the whole page.
  header: 'flex items-center gap-3.5 mb-[18px]',
  headerIcon: 'flex items-center justify-center w-7.5 h-7.5 rounded-2 bg-surface-tertiary-enabled',
  headerTitle: 'm-0 text-heading-3 text-primary',
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2', // Bordered scroll area; min-h-0 lets it hug rows and scroll under the fixed header.
  emptyWrap: 'flex-1 min-h-0 flex items-center justify-center', // Fills the space under the header and centers the empty illustration.
};

const TABLE_HEADERS: TableHeader[] = [
  { key: 'name', value: 'Name' },
  { key: 'owner', value: 'Owner' },
  { key: 'edited', value: 'Edited' },
];

export type TableHeader = { key: string; value: string };
// Cell values mirror ds-web Table's CellData (no null/boolean ReactNode members).
export type PageRow = {
  id: string;
  rowData: { key: string; value: string | number | ReactElement | undefined; prefix?: ReactElement }[];
};

function defaultToRow(doc: DocumentDto): PageRow {
  const PageIcon = pageTypeIcon(doc.type);
  return {
    id: doc.id,
    rowData: [
      {
        key: 'name',
        value: doc.title,
        prefix: <PageIcon size="xx-small" variant="subtle" />,
      },
      {
        key: 'owner',
        value: firstName(doc.owner.name),
        prefix: (
          <Avatar
            dsVersion="2.0"
            name={doc.owner.name}
            color={dsAvatarColor(doc.owner.color, doc.owner.id)}
            size="small"
            shape="circle"
          />
        ),
      },
      { key: 'edited', value: <span className="tabular-nums">{relativeTime(doc.updatedAt)}</span> },
    ],
  };
}

type PagesListViewProps<T extends DocumentDto> = {
  title: string;
  icon: ReactNode;
  docs: T[];
  onOpenDoc: (id: string | number) => void;
  emptyState: ReactNode;
  // Optional column overrides (e.g. Shared with me); defaults to Name/Owner/Edited/Sharing.
  headers?: TableHeader[];
  toRow?: (doc: T) => PageRow;
};

// Shared shell for the workspace page lists (All pages, Starred, Shared with me): a titled
// header over a bounded, fixed-header table — or the caller's empty state when there are none.
export function PagesListView<T extends DocumentDto>({
  title,
  icon,
  docs,
  onOpenDoc,
  emptyState,
  headers = TABLE_HEADERS,
  toRow = defaultToRow,
}: Readonly<PagesListViewProps<T>>) {
  // The bordered scroll area doubles as the Table's virtualization viewport, so only the rows
  // in view are mounted — a large workspace's "All pages" list stays cheap.
  const tableWrapRef = useRef<HTMLDivElement>(null);
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
          <div ref={tableWrapRef} className={styles.tableWrap}>
            <Table
              dsVersion="2.0"
              headers={headers}
              data={docs.map(toRow)}
              onRowClick={onOpenDoc}
              isHeaderFixed
              scrollContainerRef={tableWrapRef}
              height="100%"
              rowHeight={44}
            />
          </div>
        )}
      </div>
    </main>
  );
}
