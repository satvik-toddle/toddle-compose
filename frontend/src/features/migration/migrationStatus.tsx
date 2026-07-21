import type { ReactNode } from 'react';
import { Tooltip } from '@toddle-edu/ds-web';
import {
  ClockFilled,
  CloseCircleFilled,
  MinusCircleFilled,
  MinusCircleOutlined,
  TickCircleFilled,
} from '@toddle-edu/ds-icons';
import type { MigrationItemStatus, MigrationJobStatus } from '../../types/api';

// Status shows as a compact colored icon (name lives in aria-label + tooltip).
const ICON_SIZE = 'xx-small' as const;

// GitHub-Actions-style running loader: a static yellow center dot with a
// spinning yellow outline ring (one side transparent) around it.
function RunningSpinner() {
  const yellow = 'var(--icon-semantic-warning)';
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <span
        className="absolute inset-0 animate-spin rounded-full border-2"
        style={{ borderColor: yellow, borderTopColor: 'transparent' }}
      />
      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: yellow }} />
    </span>
  );
}

function StatusBadge({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Tooltip dsVersion="2.0" placement="top" showArrow tooltip={label}>
      <span role="img" aria-label={label} className="inline-flex items-center">
        {children}
      </span>
    </Tooltip>
  );
}

const JOB_STATUS: Record<MigrationJobStatus, { label: string; node: ReactNode }> = {
  QUEUED: { label: 'Queued', node: <ClockFilled size={ICON_SIZE} variant="default" /> },
  RUNNING: { label: 'Running', node: <RunningSpinner /> },
  PARTIAL: { label: 'Partial', node: <MinusCircleOutlined size={ICON_SIZE} variant="warning" /> },
  SUCCEEDED: { label: 'Succeeded', node: <TickCircleFilled size={ICON_SIZE} variant="success" /> },
  FAILED: { label: 'Failed', node: <CloseCircleFilled size={ICON_SIZE} variant="critical" /> },
  CANCELED: { label: 'Canceled', node: <MinusCircleFilled size={ICON_SIZE} variant="subtle" /> },
};

const ITEM_STATUS: Record<MigrationItemStatus, { label: string; node: ReactNode }> = {
  PENDING: { label: 'Pending', node: <ClockFilled size={ICON_SIZE} variant="default" /> },
  RUNNING: { label: 'Running', node: <RunningSpinner /> },
  SUCCEEDED: { label: 'Succeeded', node: <TickCircleFilled size={ICON_SIZE} variant="success" /> },
  FAILED: { label: 'Failed', node: <CloseCircleFilled size={ICON_SIZE} variant="critical" /> },
  SKIPPED: { label: 'Skipped', node: <MinusCircleFilled size={ICON_SIZE} variant="subtle" /> },
};

export function JobStatusTag({ status }: Readonly<{ status: MigrationJobStatus }>) {
  const { label, node } = JOB_STATUS[status];
  return <StatusBadge label={label}>{node}</StatusBadge>;
}

export function ItemStatusTag({ status }: Readonly<{ status: MigrationItemStatus }>) {
  const { label, node } = ITEM_STATUS[status];
  return <StatusBadge label={label}>{node}</StatusBadge>;
}
