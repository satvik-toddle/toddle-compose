import { Alert, Button, ProgressIndicator, Table, Tooltip } from '@toddle-edu/ds-web';
import { PageLoader } from '../../components/Loader';
import { relativeTime } from '../../lib/time';
import { useCancelJob, useMigrationJob, useRetryJob } from '../../hooks/useMigrations';
import { ItemStatusTag, JobStatusTag } from './migrationStatus';
import type { MigrationJobDetail as MigrationJobDetailDto, MigrationJobItem } from '../../types/api';

const styles = {
  root: 'flex min-h-0 flex-1 flex-col gap-4',
  headerRow: 'flex flex-wrap items-center gap-3',
  title: 'm-0 text-heading-4 text-primary',
  timing: 'text-body-xs text-secondary tabular-nums',
  statsRow: 'flex flex-wrap items-center gap-4',
  stat: 'flex items-baseline gap-1.5',
  statValue: 'text-heading-5 text-primary tabular-nums',
  statLabel: 'text-body-xs text-secondary',
  actions: 'flex items-center gap-2',
  progressWrap: 'max-w-[420px]',
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2',
  errorCell: 'block max-w-[280px] truncate text-body-xs text-semantic-error',
  destLink: 'text-body-xs text-link-default underline',
  muted: 'text-body-xs text-secondary',
};

const ITEM_HEADERS = [
  { key: 'title', value: 'Page' },
  { key: 'status', value: 'Status' },
  { key: 'attempts', value: 'Attempts' },
  { key: 'destination', value: 'Destination' },
  { key: 'error', value: 'Last error' },
];

function Stat({ value, label }: Readonly<{ value: number; label: string }>) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function DestinationCell({
  item,
  resolveCodaHref,
}: Readonly<{ item: MigrationJobItem; resolveCodaHref?: (item: MigrationJobItem) => string | undefined }>) {
  if (!item.codaPageId) return <span className={styles.muted}>—</span>;
  const href = resolveCodaHref?.(item);
  if (href) {
    return (
      <a className={styles.destLink} href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        Open in Coda
      </a>
    );
  }
  return <span className={styles.muted}>{item.codaPageId}</span>;
}

function ErrorCell({ error }: Readonly<{ error: string | null }>) {
  if (!error) return <span className={styles.muted}>—</span>;
  return (
    <Tooltip dsVersion="2.0" placement="top" showArrow tooltip={error}>
      <span className={styles.errorCell}>{error}</span>
    </Tooltip>
  );
}

function ItemsTable({
  job,
  resolveCodaHref,
}: Readonly<{ job: MigrationJobDetailDto; resolveCodaHref?: (item: MigrationJobItem) => string | undefined }>) {
  const items = [...job.items].sort((a, b) => a.seq - b.seq);
  const rows = items.map((item) => ({
    id: item.id,
    rowData: [
      { key: 'title', value: item.title },
      { key: 'status', value: <ItemStatusTag status={item.status} /> },
      { key: 'attempts', value: <span className="tabular-nums">{item.attempts}</span> },
      { key: 'destination', value: <DestinationCell item={item} resolveCodaHref={resolveCodaHref} /> },
      { key: 'error', value: <ErrorCell error={item.lastError} /> },
    ],
  }));
  return (
    <div className={styles.tableWrap}>
      <Table dsVersion="2.0" headers={ITEM_HEADERS} data={rows} isHeaderFixed />
    </div>
  );
}

export type MigrationJobDetailProps = {
  jobId: string;
  // Optional: turn an item's codaPageId into an openable Coda URL; else the id is shown as text.
  resolveCodaHref?: (item: MigrationJobItem) => string | undefined;
};

// Reusable run detail — header (status, counts, error), actions (cancel / retry
// failed) and the per-item table. Polls automatically via useMigrationJob.
export function MigrationJobDetail({ jobId, resolveCodaHref }: Readonly<MigrationJobDetailProps>) {
  const { data: job, isLoading } = useMigrationJob(jobId);
  const cancel = useCancelJob();
  const retry = useRetryJob();

  if (isLoading && !job) return <PageLoader />;
  if (!job) {
    return <Alert dsVersion="2.0" type="error" message="This migration run could not be loaded." />;
  }

  const done = job.succeededItems + job.failedItems + job.skippedItems;
  const pct = job.totalItems > 0 ? Math.round((done / job.totalItems) * 100) : 0;
  const canCancel = job.status === 'QUEUED' || job.status === 'RUNNING';
  const canRetry = (job.status === 'PARTIAL' || job.status === 'FAILED') && job.failedItems > 0;

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <JobStatusTag status={job.status} />
        <span className={styles.timing}>
          {job.startedAt ? `Started ${relativeTime(job.startedAt)}` : 'Not started'}
          {job.finishedAt ? ` · Finished ${relativeTime(job.finishedAt)}` : ''}
        </span>
        <div className="ml-auto">
          <div className={styles.actions}>
            {canCancel && (
              <Button
                dsVersion="2.0"
                size="small"
                variant="destructive"
                type="outlined"
                isLoading={cancel.isPending}
                onClick={() => cancel.mutate(job.id)}
              >
                Cancel run
              </Button>
            )}
            {canRetry && (
              <Button
                dsVersion="2.0"
                size="small"
                variant="primary"
                isLoading={retry.isPending}
                onClick={() => retry.mutate(job.id)}
              >
                Retry failed
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <Stat value={job.totalItems} label="total" />
        <Stat value={job.succeededItems} label="succeeded" />
        <Stat value={job.failedItems} label="failed" />
        <Stat value={job.skippedItems} label="skipped" />
      </div>

      <div className={styles.progressWrap}>
        <ProgressIndicator
          variant="progress-bar"
          progress={pct}
          status={job.failedItems > 0 ? 'failed' : 'success'}
          aria-label={`${done} of ${job.totalItems} items processed`}
        />
      </div>

      {job.error && <Alert dsVersion="2.0" type="error" message={job.error} />}

      <ItemsTable job={job} resolveCodaHref={resolveCodaHref} />
    </div>
  );
}
