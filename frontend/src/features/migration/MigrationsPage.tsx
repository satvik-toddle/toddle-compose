import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@toddle-edu/ds-web';
import { ExportOutlined, ChevronLeftOutlined } from '@toddle-edu/ds-icons';
import { NoAccessPanel } from '../errors/NoAccessPanel';
import { useWorkspaceMembers } from '../../hooks/queries';
import { useMigrationJobs } from '../../hooks/useMigrations';
import { useWorkspaceCtx } from '../workspace/context';
import { MigrationJobsList } from './MigrationJobsList';
import { MigrationJobDetail } from './MigrationJobDetail';

const styles = {
  contentShell: 'flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--panel-bg)]',
  body: 'flex-1 min-h-0 flex flex-col pt-6 px-7.5 pb-10',
  header: 'flex items-center gap-3.5 mb-[18px]',
  headerIcon: 'flex items-center justify-center w-7.5 h-7.5 rounded-2 bg-surface-tertiary-enabled',
  headerTitle: 'm-0 text-heading-3 text-primary',
  subtitle: 'text-body-sm text-secondary mb-4',
  backRow: 'mb-3',
};

export function MigrationsPage() {
  const { workspaceId, role, isAdmin } = useWorkspaceCtx();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const canView = role === 'EDIT' || role === 'ADMIN' || isAdmin;

  const { data: jobs = [], isLoading } = useMigrationJobs({ workspaceId }, canView);
  const { data: members = [] } = useWorkspaceMembers(workspaceId, canView);

  const resolveUserName = useMemo(() => {
    const byId = new Map(members.map((m) => [m.userId, m.user.name]));
    return (userId: string) => byId.get(userId);
  }, [members]);

  if (!canView) {
    return (
      <NoAccessPanel
        title="Migrations aren't available for your role"
        message="Migration runs expose destination Coda links, so only workspace editors and admins can view them."
      />
    );
  }

  return (
    <main className={styles.contentShell}>
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <ExportOutlined size="x-small" variant="subtle" />
          </span>
          <h1 className={styles.headerTitle}>Migrations</h1>
        </div>

        {jobId ? (
          <>
            <div className={styles.backRow}>
              <Button
                dsVersion="2.0"
                size="small"
                variant="neutral"
                type="plain"
                icon={<ChevronLeftOutlined size="xx-small" />}
                onClick={() => navigate(`/w/${workspaceId}/migrations`)}
              >
                All runs
              </Button>
            </div>
            <MigrationJobDetail jobId={jobId} />
          </>
        ) : (
          <>
            <p className={styles.subtitle}>
              Track Copy-to-Coda runs for this workspace — status, per-page progress, and retries.
            </p>
            <MigrationJobsList
              jobs={jobs}
              loading={isLoading}
              onOpen={(id) => navigate(`/w/${workspaceId}/migrations/${id}`)}
              resolveUserName={resolveUserName}
            />
          </>
        )}
      </div>
    </main>
  );
}
