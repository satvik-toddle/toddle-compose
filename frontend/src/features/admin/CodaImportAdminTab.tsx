import { Fragment, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button as DsButton, EmptyState, SpinnerLoader, Table, Tooltip } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { ChevronRightOutlined } from '@toddle-edu/ds-icons';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Icon } from '../../components/Icon';
import { PageLoader } from '../../components/Loader';
import { ItemStatusTag, JobStatusTag } from '../migration/migrationStatus';
import {
  useCancelCodaImportJob,
  useCodaImportCredentials,
  useCodaImportJob,
  useCodaImportJobs,
  useCreateCodaImportCredential,
  useDeleteCodaImportCredential,
} from '../../hooks/useCodaImport';
import { relativeTime } from '../../lib/time';
import type { CodaImportCredentialView, CodaImportJobDetail, CodaImportJobSummary } from '../../types/api';

const styles = {
  page: 'flex-1 min-h-0 overflow-auto pt-6 px-7.5 pb-10',
  wrap: 'mx-auto flex min-h-0 max-w-[1040px] flex-col',
  head: 'mb-5 flex items-end justify-between gap-4',
  title: 'm-0 text-heading-3 text-primary',
  sub: 'mt-1 text-body text-secondary',
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2',
  muted: 'text-body text-secondary',
  chevron: 'flex justify-end text-secondary',
  docLink: 'max-w-[280px] truncate text-body text-link-default underline',
  backRow: 'mb-3',
  detailRoot: 'flex min-h-0 flex-1 flex-col gap-4',
  detailHead: 'flex flex-wrap items-center gap-3',
  timing: 'text-body text-secondary tabular-nums',
  errorCell: 'block max-w-[280px] truncate text-body text-semantic-error',
  progressLive: 'flex items-center gap-1.5',
  detailActions: 'ml-auto flex items-center gap-2',
  fetchingMore: 'flex items-center gap-2 text-body text-secondary',
  rowActions: 'flex items-center justify-end gap-2',
  stepper: 'flex flex-col gap-2 rounded-2 border border-secondary bg-surface-secondary px-4 py-3.5',
  stepperTrack: 'flex items-center',
  stepConnector: 'h-0.5 flex-1 rounded-full',
  stepCircle: 'flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full',
  stepNumDone: 'text-label-s text-white',
  stepNumPending: 'text-label-s text-inverse',
  statusWord: 'text-body text-secondary',
  tokensSection: 'mb-8',
  tokensHead: 'mb-3 flex items-end justify-between gap-4',
  tokensTitle: 'm-0 text-heading-4 text-primary',
  tokensSub: 'mt-1 text-body text-secondary',
  tokenList: 'flex flex-col gap-2',
  tokenRow: 'flex items-center gap-3 border border-secondary rounded-2 px-3.5 py-2.5',
  tokenMask: 'text-body text-primary',
  tokenMeta: 'text-body text-secondary',
  tokenGap: 'ml-auto',
  tokensLoading: 'flex items-center gap-2 text-body text-secondary py-2',
  note: 'flex items-start gap-2 text-body text-secondary',
};

// The two exact DS tokens the stepper paints with. Only bg-interactive-semantic-info
// compiles as a utility; inverse-hover does not, so both go through inline vars for
// consistency and guaranteed-exact color.
const STEP_DONE_COLOR = 'var(--interactive-semantic-info)';
const STEP_PENDING_COLOR = 'var(--interactive-inverse-hover)';

// The five fixed phases of an import; words match the live/terminal status line.
const IMPORT_STEPS = [
  { active: 'Creating workspace', done: 'Workspace created' },
  { active: 'Fetching pages', done: 'Pages fetched' },
  { active: 'Planning documents', done: 'Documents planned' },
  { active: 'Importing documents', done: 'Documents imported' },
  { active: 'Finishing', done: 'Completed' },
];

// Highest phase (0-based) the milestones prove the run has reached; matches on the
// exact backend milestone-message prefixes.
function reachedStep(events: CodaImportJobDetail['events']): number {
  let reached = 0;
  for (const { message: m } of events) {
    let idx = 0;
    if (m.startsWith('Importing')) idx = 3;
    else if (m.startsWith('Found') || m.startsWith('Planned')) idx = 2;
    else if (m.startsWith('Fetching') || m.startsWith('Fetched')) idx = 1;
    else if (m.startsWith('Workspace ')) idx = 0;
    else continue;
    if (idx > reached) reached = idx;
  }
  return reached;
}

// Horizontal 5-step stepper + one live status-word line. Terminal jobs show all
// five done; live jobs spin on the current phase.
function ImportStepper({ job }: Readonly<{ job: CodaImportJobDetail }>) {
  const live = isLive(job.status);
  const reached = reachedStep(job.events);
  const stateOf = (i: number): 'done' | 'active' | 'pending' => {
    if (!live) return 'done';
    if (i < reached) return 'done';
    return i === reached ? 'active' : 'pending';
  };

  const lastEvent = job.events[job.events.length - 1];
  const statusWord = live
    ? (job.progressMessage ?? IMPORT_STEPS[reached].active ?? 'Starting…')
    : (lastEvent?.message ?? IMPORT_STEPS[4].done);

  return (
    <div className={styles.stepper}>
      <div className={styles.stepperTrack}>
        {IMPORT_STEPS.map((_, i) => {
          const state = stateOf(i);
          return (
            <Fragment key={i}>
              {i > 0 && (
                <span
                  className={styles.stepConnector}
                  style={{ backgroundColor: stateOf(i - 1) === 'done' ? STEP_DONE_COLOR : STEP_PENDING_COLOR }}
                />
              )}
              <span
                className={styles.stepCircle}
                style={{ backgroundColor: state === 'pending' ? STEP_PENDING_COLOR : STEP_DONE_COLOR }}
              >
                {state === 'active' ? (
                  <SpinnerLoader size="xxx-small" variant="on" />
                ) : (
                  <span className={state === 'done' ? styles.stepNumDone : styles.stepNumPending}>{i + 1}</span>
                )}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className={styles.statusWord}>{statusWord}</div>
    </div>
  );
}

// QUEUED/RUNNING = the worker is still listing pages, planning, or importing.
function isLive(status: CodaImportJobSummary['status']): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

const JOB_HEADERS = [
  { key: 'status', value: 'Status' },
  { key: 'workspace', value: 'Workspace' },
  { key: 'source', value: 'Coda doc' },
  { key: 'progress', value: 'Progress' },
  { key: 'started', value: 'Started' },
  { key: 'open', value: '' },
];

const ITEM_HEADERS = [
  { key: 'page', value: 'Coda page' },
  { key: 'status', value: 'Status' },
  { key: 'doc', value: 'Created doc' },
  { key: 'error', value: 'Last error' },
];

// "n/total done" with failed/skipped noted when present.
function progressLabel(job: CodaImportJobSummary): string {
  const done = `${job.succeededItems}/${job.totalItems} done`;
  const extra: string[] = [];
  if (job.failedItems > 0) extra.push(`${job.failedItems} failed`);
  if (job.skippedItems > 0) extra.push(`${job.skippedItems} skipped`);
  return extra.length ? `${done} · ${extra.join(', ')}` : done;
}

function JobsList({
  jobs,
  loading,
  onOpen,
  onCancel,
  cancelingId,
}: Readonly<{
  jobs: CodaImportJobSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  cancelingId: string | null;
}>) {
  if (loading) return <PageLoader />;
  if (jobs.length === 0) {
    return (
      <EmptyState
        dsVersion="2.0"
        illustration={EmptyStateIllustrations.NoFoldersIllustration}
        title="No imports yet"
        subtitle="Import a Coda doc from the Workspaces tab. Runs show up here with live progress."
      />
    );
  }

  const rows = jobs.map((job) => ({
    id: job.id,
    rowData: [
      { key: 'status', value: <JobStatusTag status={job.status} /> },
      { key: 'workspace', value: <span className="text-body text-primary">{job.targetWorkspaceName}</span> },
      {
        key: 'source',
        value: (
          <a
            className={styles.docLink}
            href={job.codaDocUrl}
            target="_blank"
            rel="noreferrer"
            title={job.codaDocUrl}
          >
            {job.codaDocUrl}
          </a>
        ),
      },
      {
        key: 'progress',
        value: isLive(job.status) ? (
          <span className={styles.progressLive}>
            <SpinnerLoader size="xxx-small" variant="default" />
            <span className={styles.muted}>{job.progressMessage ?? progressLabel(job)}</span>
          </span>
        ) : (
          <span className={styles.muted}>{progressLabel(job)}</span>
        ),
      },
      {
        key: 'started',
        value: <span className={styles.muted}>{job.startedAt ? relativeTime(job.startedAt) : '—'}</span>,
      },
      {
        key: 'open',
        value: (
          <span className={styles.rowActions}>
            {isLive(job.status) && (
              <DsButton
                dsVersion="2.0"
                size="small"
                variant="destructive"
                type="plain"
                isLoading={cancelingId === job.id}
                // Stop the row's onRowClick (navigate) from also firing.
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onCancel(job.id);
                }}
              >
                Cancel
              </DsButton>
            )}
            <span className={styles.chevron}>
              <ChevronRightOutlined size="xx-small" variant="subtle" />
            </span>
          </span>
        ),
      },
    ],
  }));

  return (
    <div className={styles.tableWrap}>
      <Table dsVersion="2.0" headers={JOB_HEADERS} data={rows} onRowClick={(id) => onOpen(String(id))} isHeaderFixed />
    </div>
  );
}

function ErrorCell({ error }: Readonly<{ error: string | null }>) {
  if (!error) return <span className={styles.muted}>—</span>;
  return (
    <Tooltip dsVersion="2.0" placement="top" showArrow tooltip={error}>
      <span className={styles.errorCell}>{error}</span>
    </Tooltip>
  );
}

function JobDetail({
  job,
  onCancel,
  canceling,
}: Readonly<{ job: CodaImportJobDetail; onCancel: (id: string) => void; canceling: boolean }>) {
  const items = [...job.items].sort((a, b) => a.seq - b.seq);
  const rows = items.map((item) => ({
    id: item.id,
    rowData: [
      { key: 'page', value: <span className="text-body text-primary">{item.codaPageName}</span> },
      { key: 'status', value: <ItemStatusTag status={item.status} /> },
      { key: 'doc', value: <span className={styles.muted}>{item.createdDocId ?? '—'}</span> },
      { key: 'error', value: <ErrorCell error={item.lastError} /> },
    ],
  }));

  // While a live job is still planning (whole-doc imports create rows per page-batch),
  // trail the real rows with a synthetic "fetching more" row so the table reads as
  // "rows so far + more coming". Removed once planningComplete.
  if (isLive(job.status) && !job.planningComplete) {
    rows.push({
      id: '__fetching-more__',
      rowData: [
        {
          key: 'page',
          value: (
            <span className={styles.fetchingMore}>
              <SpinnerLoader size="xxx-small" variant="default" />
              Fetching more pages…
            </span>
          ),
        },
        { key: 'status', value: <span className={styles.muted}>—</span> },
        { key: 'doc', value: <span className={styles.muted}>—</span> },
        { key: 'error', value: <span className={styles.muted}>—</span> },
      ],
    });
  }

  return (
    <div className={styles.detailRoot}>
      <div className={styles.detailHead}>
        <JobStatusTag status={job.status} />
        <span className="text-body text-primary">{job.targetWorkspaceName}</span>
        <span className={styles.timing}>
          {job.startedAt ? `Started ${relativeTime(job.startedAt)}` : 'Not started'}
          {job.finishedAt ? ` · Finished ${relativeTime(job.finishedAt)}` : ''}
        </span>
        {isLive(job.status) && (
          <span className={styles.detailActions}>
            <DsButton
              dsVersion="2.0"
              size="small"
              variant="destructive"
              type="outlined"
              isLoading={canceling}
              onClick={() => onCancel(job.id)}
            >
              Cancel import
            </DsButton>
          </span>
        )}
      </div>
      <ImportStepper job={job} />
      <div className={styles.tableWrap}>
        <Table dsVersion="2.0" headers={ITEM_HEADERS} data={rows} isHeaderFixed />
      </div>
    </div>
  );
}

function JobDetailView({ jobId }: Readonly<{ jobId: string }>) {
  const { data: job, isLoading } = useCodaImportJob(jobId);
  const cancel = useCancelCodaImportJob();
  if (isLoading && !job) return <PageLoader />;
  if (!job) return <Alert dsVersion="2.0" type="error" message="This import could not be loaded." />;
  return (
    <JobDetail
      job={job}
      canceling={cancel.isPending}
      onCancel={(id) => {
        if (window.confirm('Cancel this import? Docs already created stay in the workspace.')) {
          cancel.mutate(id);
        }
      }}
    />
  );
}

function maskCredential(c: CodaImportCredentialView): string {
  return `${c.label ?? 'Token'} ··· ${c.hint ?? '????'}`;
}

// Realm-wide token an import can be pinned to. Adding opens the modal; deleting a
// token in use will fail its imports, so it's confirmed first.
function CodaTokensPanel() {
  const { data: credentials, isLoading } = useCodaImportCredentials();
  const del = useDeleteCodaImportCredential();
  const [adding, setAdding] = useState(false);
  const deletingId = del.isPending ? (del.variables ?? null) : null;

  const onDelete = (id: string) => {
    if (window.confirm('Delete this Coda token? Imports pinned to it will fail.')) {
      del.mutate(id);
    }
  };

  return (
    <section className={styles.tokensSection}>
      <div className={styles.tokensHead}>
        <div>
          <h2 className={styles.tokensTitle}>Coda tokens</h2>
          <div className={styles.tokensSub}>
            Tokens the realm's Coda imports run under. Each token is a Coda user with read access
            to the docs you import.
          </div>
        </div>
        <Button icon="AddOutlined" onClick={() => setAdding(true)}>
          Add token
        </Button>
      </div>

      {isLoading ? (
        <div className={styles.tokensLoading}>
          <SpinnerLoader size="xxx-small" variant="default" />
          Loading tokens…
        </div>
      ) : (credentials?.length ?? 0) === 0 ? (
        <div className={styles.muted}>No tokens yet — add one to enable Coda imports.</div>
      ) : (
        <div className={styles.tokenList}>
          {credentials?.map((c) => (
            <div key={c.id} className={styles.tokenRow}>
              <span className={styles.tokenMask}>{maskCredential(c)}</span>
              <span className={styles.tokenGap} />
              <span className={styles.tokenMeta}>Added {relativeTime(c.createdAt)}</span>
              {deletingId === c.id ? (
                <SpinnerLoader size="xxx-small" variant="default" />
              ) : (
                <IconButton
                  icon="DeleteOutlined"
                  red
                  title="Delete token"
                  aria-label="Delete token"
                  disabled={del.isPending}
                  onClick={() => onDelete(c.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {adding && <AddCodaTokenModal onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddCodaTokenModal({ onClose }: Readonly<{ onClose: () => void }>) {
  const create = useCreateCodaImportCredential();
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = token.trim();
    if (!trimmed || create.isPending) return;
    setError(null);
    create.mutate(
      { token: trimmed, ...(label.trim() ? { label: label.trim() } : {}) },
      {
        onSuccess: () => {
          setToken('');
          setLabel('');
          onClose();
        },
        // The hook already toasts; surface it inline too so the modal stays open on error.
        onError: (e) => setError((e as Error)?.message ?? 'Could not add the token.'),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="brand"
        icon="ImportOutlined"
        title="Add Coda token"
        sub="A Coda API token the realm's imports can run under."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Coda API token">
          <TextInput
            type="password"
            autoComplete="new-password"
            placeholder="Paste a Coda API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Label (optional)">
          <TextInput
            placeholder="Who/what this token is for"
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        <div className={styles.note}>
          <Icon name="InformationOutlined" size={14} muted />
          <span>Generate a token at coda.io → Account Settings → API Settings.</span>
        </div>

        {error && <Alert dsVersion="2.0" type="error" message={error} />}
      </div>

      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon="AddOutlined"
          disabled={!token.trim() || create.isPending}
          onClick={submit}
        >
          {create.isPending ? 'Adding…' : 'Add token'}
        </Button>
      </div>
    </Modal>
  );
}

export function CodaImportAdminTab() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const { data: jobs = [], isLoading } = useCodaImportJobs();
  const cancel = useCancelCodaImportJob();

  // A single run opens as a detail view (route /admin/coda-import/:jobId).
  if (jobId) {
    return (
      <div className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.backRow}>
            <Button
              size="sm"
              variant="ghost"
              icon="ChevronLeftOutlined"
              onClick={() => navigate('/admin/coda-import')}
            >
              All imports
            </Button>
          </div>
          <JobDetailView jobId={jobId} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>Coda imports</h1>
            <div className={styles.sub}>
              Track Coda doc imports across the realm. Each import creates a new workspace.
            </div>
          </div>
        </div>
        <CodaTokensPanel />
        <JobsList
          jobs={jobs}
          loading={isLoading}
          onOpen={(id) => navigate(`/admin/coda-import/${id}`)}
          cancelingId={cancel.isPending ? (cancel.variables ?? null) : null}
          onCancel={(id) => {
            if (window.confirm('Cancel this import? Docs already created stay in the workspace.')) {
              cancel.mutate(id);
            }
          }}
        />
      </div>
    </div>
  );
}
