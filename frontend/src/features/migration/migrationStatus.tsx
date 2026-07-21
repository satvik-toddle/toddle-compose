import { Tag } from '@toddle-edu/ds-web';
import type { MigrationItemStatus, MigrationJobStatus } from '../../types/api';

// DS Tag colors keyed by run status — a GitHub-Actions-style status pill.
type TagColor = 'neutral' | 'blue' | 'yellow' | 'green' | 'red';

const JOB_STATUS: Record<MigrationJobStatus, { color: TagColor; label: string }> = {
  QUEUED: { color: 'neutral', label: 'Queued' },
  RUNNING: { color: 'blue', label: 'Running' },
  PARTIAL: { color: 'yellow', label: 'Partial' },
  SUCCEEDED: { color: 'green', label: 'Succeeded' },
  FAILED: { color: 'red', label: 'Failed' },
  CANCELED: { color: 'neutral', label: 'Canceled' },
};

const ITEM_STATUS: Record<MigrationItemStatus, { color: TagColor; label: string }> = {
  PENDING: { color: 'neutral', label: 'Pending' },
  RUNNING: { color: 'blue', label: 'Running' },
  SUCCEEDED: { color: 'green', label: 'Succeeded' },
  FAILED: { color: 'red', label: 'Failed' },
  SKIPPED: { color: 'yellow', label: 'Skipped' },
};

export function JobStatusTag({ status }: Readonly<{ status: MigrationJobStatus }>) {
  const { color, label } = JOB_STATUS[status];
  return (
    <Tag dsVersion="2.0" size="small" color={color}>
      {label}
    </Tag>
  );
}

export function ItemStatusTag({ status }: Readonly<{ status: MigrationItemStatus }>) {
  const { color, label } = ITEM_STATUS[status];
  return (
    <Tag dsVersion="2.0" size="small" color={color}>
      {label}
    </Tag>
  );
}
