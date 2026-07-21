import { EmptyState, ProgressIndicator, Table } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { ChevronRightOutlined } from '@toddle-edu/ds-icons';
import { PageLoader } from '../../components/Loader';
import { relativeTime } from '../../lib/time';
import { JobStatusTag } from './migrationStatus';
import type { MigrationJobSummary } from '../../types/api';

const styles = {
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2',
  progressCell: 'flex flex-col gap-1 min-w-[140px]',
  progressText: 'text-body-xs text-secondary tabular-nums',
  muted: 'text-body-xs text-secondary',
  chevron: 'flex justify-end text-secondary',
};

const HEADERS = [
  { key: 'status', value: 'Status' },
  { key: 'progress', value: 'Progress' },
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

function ProgressCell({ job }: Readonly<{ job: MigrationJobSummary }>) {
  const done = job.succeededItems + job.failedItems + job.skippedItems;
  const pct = job.totalItems > 0 ? Math.round((done / job.totalItems) * 100) : 0;
  const bits = [`${job.succeededItems}/${job.totalItems}`];
  if (job.failedItems > 0) bits.push(`${job.failedItems} failed`);
  if (job.skippedItems > 0) bits.push(`${job.skippedItems} skipped`);
  return (
    <div className={styles.progressCell}>
      <ProgressIndicator
        variant="progress-bar"
        progress={pct}
        status={job.failedItems > 0 ? 'failed' : 'success'}
        aria-label={`${done} of ${job.totalItems} items processed`}
      />
      <span className={styles.progressText}>{bits.join(' · ')}</span>
    </div>
  );
}

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
      { key: 'progress', value: <ProgressCell job={job} /> },
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
