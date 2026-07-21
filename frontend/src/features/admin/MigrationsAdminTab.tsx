import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, SegmentControl, Table } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { PageLoader } from '../../components/Loader';
import { MigrationJobsList } from '../migration/MigrationJobsList';
import { MigrationJobDetail } from '../migration/MigrationJobDetail';
import { MigrationScopeFormModal } from './MigrationScopeFormModal';
import { useMigrationJobs, useMigrationScopes, useDeleteScope } from '../../hooks/useMigrations';
import { useRealmMembers, useWorkspaces } from '../../hooks/queries';
import { pushToast } from '../../stores/uiStore';
import { formatDate } from '../../lib/time';
import type { MigrationScope } from '../../types/api';

type Section = 'destinations' | 'runs';

const SECTION_OPTIONS = [
  { value: 'destinations', label: 'Destinations' },
  { value: 'runs', label: 'Runs' },
];

const SCOPE_HEADERS = [
  { key: 'label', value: 'Name' },
  { key: 'workspace', value: 'Workspace' },
  { key: 'destination', value: 'Coda destination' },
  { key: 'tokens', value: 'Tokens' },
  { key: 'created', value: 'Created' },
  { key: 'actions', value: '' },
];

const styles = {
  page: 'flex-1 min-h-0 overflow-auto pt-6 px-7.5 pb-10',
  wrap: 'mx-auto flex min-h-0 max-w-[1040px] flex-col',
  head: 'mb-5 flex items-end justify-between gap-4',
  title: 'm-0 text-heading-3 text-primary',
  sub: 'mt-1 text-body text-secondary',
  seg: 'mb-5 max-w-[280px]',
  tableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2',
  destLink: 'max-w-[280px] truncate text-body text-link-default underline',
  tokenCell: 'flex flex-wrap items-center gap-1.5',
  chip: 'rounded-2 bg-surface-secondary-enabled px-1.5 py-0.5 text-body text-secondary tabular-nums',
  muted: 'text-body text-secondary',
  actions: 'flex items-center justify-end gap-1.5',
  backRow: 'mb-3',
};

// Confirm soft-deleting a destination — warns that its in-flight jobs are canceled.
function ConfirmDeleteScopeModal({
  scope,
  onClose,
}: Readonly<{ scope: MigrationScope; onClose: () => void }>) {
  const del = useDeleteScope();
  const submit = () =>
    del.mutate(scope.id, {
      onSuccess: () => {
        pushToast({ kind: 'success', message: 'Destination deleted' });
        onClose();
      },
    });
  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="danger"
        icon="DeleteOutlined"
        title={`Delete "${scope.label}"?`}
        sub="Migrations can no longer target this destination."
        onClose={onClose}
      />
      <div className="m-body">
        <div className="danger-box">
          <Icon name="WarningTriangleOutlined" size={14} red />
          <span>
            Any in-flight migration jobs writing to this destination are canceled. Pages already
            copied into Coda are left in place.
          </span>
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon="DeleteOutlined"
          disabled={del.isPending}
          onClick={submit}
        >
          {del.isPending ? 'Deleting…' : 'Delete destination'}
        </Button>
      </div>
    </Modal>
  );
}

export function MigrationsAdminTab() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const [section, setSection] = useState<Section>('destinations');
  const [formScope, setFormScope] = useState<MigrationScope | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<MigrationScope | null>(null);

  const { data: scopes = [], isLoading: scopesLoading } = useMigrationScopes();
  const { data: jobs = [], isLoading: jobsLoading } = useMigrationJobs({});
  const { data: workspaces = [] } = useWorkspaces();
  const { data: members = [] } = useRealmMembers();

  const workspaceName = useMemo(() => {
    const byId = new Map(workspaces.map((w) => [w.id, w.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [workspaces]);

  const resolveUserName = useMemo(() => {
    const byId = new Map(members.map((m) => [m.userId, m.user.name]));
    return (userId: string) => byId.get(userId);
  }, [members]);

  const openAdd = () => {
    setFormScope(null);
    setFormOpen(true);
  };
  const openEdit = (scope: MigrationScope) => {
    setFormScope(scope);
    setFormOpen(true);
  };

  // A single run opens as a detail view (route /admin/migrations/:jobId).
  if (jobId) {
    return (
      <div className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.backRow}>
            <Button
              size="sm"
              variant="ghost"
              icon="ChevronLeftOutlined"
              onClick={() => navigate('/admin/migrations')}
            >
              All runs
            </Button>
          </div>
          <MigrationJobDetail jobId={jobId} />
        </div>
      </div>
    );
  }

  const scopeRows = scopes.map((scope) => ({
    id: scope.id,
    rowData: [
      { key: 'label', value: <span className="text-body text-primary">{scope.label}</span> },
      { key: 'workspace', value: <span className={styles.muted}>{workspaceName(scope.workspaceId)}</span> },
      {
        key: 'destination',
        value: (
          <a
            className={styles.destLink}
            href={scope.codaRootUrl}
            target="_blank"
            rel="noreferrer"
            title={scope.codaRootUrl}
          >
            {scope.codaRootUrl}
          </a>
        ),
      },
      {
        key: 'tokens',
        value: (
          <span className={styles.tokenCell}>
            {scope.tokens.slice(0, 3).map((t) => (
              <span key={t.id} className={styles.chip}>
                ••••{t.hint ?? '????'}
              </span>
            ))}
            {scope.tokens.length > 3 && (
              <span className={styles.muted}>+{scope.tokens.length - 3}</span>
            )}
            {scope.tokens.length === 0 && <span className={styles.muted}>—</span>}
          </span>
        ),
      },
      { key: 'created', value: <span className={styles.muted}>{formatDate(scope.createdAt)}</span> },
      {
        key: 'actions',
        value: (
          <span className={styles.actions}>
            <Button size="sm" variant="ghost" icon="PencilOutlined" onClick={() => openEdit(scope)}>
              Edit
            </Button>
            <IconButton
              icon="DeleteOutlined"
              red
              title="Delete destination"
              aria-label="Delete destination"
              onClick={() => setDeleteScope(scope)}
            />
          </span>
        ),
      },
    ],
  }));

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>Migrations</h1>
            <div className={styles.sub}>
              Manage Coda destinations for every workspace and track migration runs across the realm.
            </div>
          </div>
          {section === 'destinations' && (
            <Button variant="primary" icon="AddOutlined" onClick={openAdd}>
              Add destination
            </Button>
          )}
        </div>

        <div className={styles.seg}>
          <SegmentControl
            dsVersion="2.0"
            size="medium"
            width="100%"
            options={SECTION_OPTIONS}
            value={section}
            onChange={(v: string) => setSection(v as Section)}
            aria-label="Destinations or runs"
          />
        </div>

        {section === 'destinations' ? (
          scopesLoading ? (
            <PageLoader />
          ) : scopes.length === 0 ? (
            <EmptyState
              dsVersion="2.0"
              illustration={EmptyStateIllustrations.NoFoldersIllustration}
              title="No destinations yet"
              subtitle="Add a Coda destination so workspaces can copy pages into it."
            />
          ) : (
            <div className={styles.tableWrap}>
              <Table dsVersion="2.0" headers={SCOPE_HEADERS} data={scopeRows} isHeaderFixed />
            </div>
          )
        ) : (
          <MigrationJobsList
            jobs={jobs}
            loading={jobsLoading}
            onOpen={(id) => navigate(`/admin/migrations/${id}`)}
            resolveUserName={resolveUserName}
          />
        )}
      </div>

      {formOpen && (
        <MigrationScopeFormModal
          scope={formScope ?? undefined}
          onClose={() => setFormOpen(false)}
        />
      )}
      {deleteScope && (
        <ConfirmDeleteScopeModal scope={deleteScope} onClose={() => setDeleteScope(null)} />
      )}
    </div>
  );
}
