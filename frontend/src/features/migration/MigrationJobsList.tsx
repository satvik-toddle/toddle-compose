import { EmptyState, Table } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { ChevronRightOutlined } from '@toddle-edu/ds-icons';
import { PageLoader } from '../../components/Loader';
import { relativeTime } from '../../lib/time';
import { JobStatusTag } from './migrationStatus';
import type { MigrationJobSummary } from '../../types/api';

const styles = {
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2',
  muted: 'text-body text-secondary',
  chevron: 'flex justify-end text-secondary',
};

const HEADERS = [
  { key: 'status', value: 'Status' },
  { key: 'initiatedBy', value: 'Initiated by' },
  { key: 'started', value: 'Started' },
  { key: 'finished', value: 'Finished' },
  { key: 'open', value: '' },
];

export type MigrationJobsListProps = {
  jobs: MigrationJobSummary[];
  onOpen: (jobId: string) => void;
  loading?: boolean;
  // Resolve a creator id to a display name; falls back to the raw id when absent.
  resolveUserName?: (userId: string) => string | undefined;
};

// Reusable run list — a GitHub-Actions-style table of migration runs. Holds no
// workspace assumptions, so the admin org view can pass all-workspace jobs in.
export function MigrationJobsList({ jobs, onOpen, loading, resolveUserName }: Readonly<MigrationJobsListProps>) {
  if (loading) return <PageLoader />;

  if (jobs.length === 0) {
    return (
      <EmptyState
        dsVersion="2.0"
        illustration={EmptyStateIllustrations.NoFoldersIllustration}
        title="No migration runs yet"
        subtitle="Copy a page to Coda to start a run. It will show up here with live progress."
      />
    );
  }

  const rows = jobs.map((job) => ({
    id: job.id,
    rowData: [
      { key: 'status', value: <JobStatusTag status={job.status} /> },
      {
        key: 'initiatedBy',
        value: resolveUserName?.(job.createdById) ?? job.createdById,
      },
      {
        key: 'started',
        value: <span className={styles.muted}>{job.startedAt ? relativeTime(job.startedAt) : '—'}</span>,
      },
      {
        key: 'finished',
        value: <span className={styles.muted}>{job.finishedAt ? relativeTime(job.finishedAt) : '—'}</span>,
      },
      {
        key: 'open',
        value: (
          <span className={styles.chevron}>
            <ChevronRightOutlined size="xx-small" variant="subtle" />
          </span>
        ),
      },
    ],
  }));

  return (
    <div className={styles.tableWrap}>
      <Table dsVersion="2.0" headers={HEADERS} data={rows} onRowClick={(id) => onOpen(String(id))} isHeaderFixed />
    </div>
  );
}
