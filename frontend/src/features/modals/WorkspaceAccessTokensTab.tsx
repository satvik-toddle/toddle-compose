import { useMemo, useState } from 'react';
import { TextInput, Tag } from '@toddle-edu/ds-web';
import { KeyDiagonalOutlined } from '@toddle-edu/ds-icons';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { RoleSelect } from '../../components/RoleSelect';
import { PageLoader } from '../../components/Loader';
import { tableStyles as t } from '../../components/tableStyles';
import { useAccessTokens } from '../../hooks/queries';
import { useCreateAccessToken, useRevokeAccessToken } from '../../hooks/useAccessTokenMutations';
import { pushToast } from '../../stores/uiStore';
import { formatDate } from '../../lib/time';
import { cn } from '../../lib/cn';
import type { AccessToken, AccessTokenPermission } from '../../types/api';

// MAINTAINER is realm-only; a workspace token tops out at ADMIN.
const PERMISSIONS: AccessTokenPermission[] = ['VIEW', 'COMMENT', 'EDIT', 'ADMIN'];
const PERMISSION_LABEL: Record<AccessTokenPermission, string> = {
  VIEW: 'View',
  COMMENT: 'Comment',
  EDIT: 'Edit',
  ADMIN: 'Admin',
  MAINTAINER: 'Maintainer',
};
const PERMISSION_COLOR: Record<AccessTokenPermission, 'neutral' | 'blue' | 'teal' | 'violet' | 'orange'> = {
  VIEW: 'neutral',
  COMMENT: 'blue',
  EDIT: 'teal',
  ADMIN: 'violet',
  MAINTAINER: 'orange',
};
const PERMISSION_OPTIONS = PERMISSIONS.map((p) => ({ value: p, label: PERMISSION_LABEL[p] }));

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const TOKEN_GRID = 'grid-cols-[2fr_130px_120px_100px_64px]';

const styles = {
  root: 'flex flex-col gap-3.5',
  toolbar: 'flex flex-col items-center justify-between gap-2',
  toolbarActions: 'flex w-full justify-end',
  intro: 'text-body-s text-secondary',
  reveal:
    'flex flex-col gap-2.5 rounded-3 border border-[var(--border-semantic-success,var(--line))] bg-[var(--surface-semantic-success-subtle,var(--surface-secondary-enabled))] px-4 py-3.5',
  revealHead:
    'flex items-center gap-2 text-body-s font-semibold text-[var(--text-semantic-success,var(--text-primary))]',
  revealRow: 'flex items-center gap-2.5',
  tokenCode:
    'flex-1 overflow-x-auto whitespace-nowrap rounded-2 border border-[var(--line)] bg-surface-primary-enabled px-3 py-2 font-mono text-[13px] text-primary',
  form: 'flex flex-col gap-4 rounded-3 border border-[var(--line)] bg-surface-secondary-enabled px-4 py-4',
  formGrid: 'flex flex-wrap gap-4',
  fieldWide: 'flex min-w-[200px] flex-1 flex-col gap-1.5',
  field: 'flex min-w-[150px] flex-col gap-1.5',
  fieldLabel: 'text-label-xs font-semibold text-secondary',
  formActions: 'flex justify-end gap-2',
  empty:
    'rounded-3 border border-dashed border-[var(--line)] px-4 py-10 text-center text-body-s text-secondary',
  rowInactive: 'opacity-60',
  cellDash: 'text-secondary',
};

// A revoked or past-expiry token stays listed (audit trail) but reads as inactive.
function statusOf(token: AccessToken): { label: string; tone: 'green' | 'neutral' } {
  if (token.revokedAt) return { label: 'Revoked', tone: 'neutral' };
  if (token.expiresAt && new Date(token.expiresAt).getTime() < Date.now())
    return { label: 'Expired', tone: 'neutral' };
  return { label: 'Active', tone: 'green' };
}

export interface WorkspaceAccessTokensTabProps {
  workspaceId: string;
}

export function WorkspaceAccessTokensTab({ workspaceId }: Readonly<WorkspaceAccessTokensTabProps>) {
  const { data: allTokens, isLoading } = useAccessTokens(true);
  const create = useCreateAccessToken();
  const revoke = useRevokeAccessToken();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<AccessTokenPermission>('EDIT');
  const [expiresInDays, setExpiresInDays] = useState('90');
  // The raw secret is returned exactly once; hold it here until dismissed.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  // Only this workspace's tokens (the API returns the caller's tokens across scopes).
  const tokens = useMemo(
    () => (allTokens ?? []).filter((tk) => tk.scope === 'WORKSPACE' && tk.workspaceId === workspaceId),
    [allTokens, workspaceId],
  );

  const resetForm = () => {
    setName('');
    setPermission('EDIT');
    setExpiresInDays('90');
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        name: trimmed,
        scope: 'WORKSPACE',
        workspaceId,
        permission,
        expiresInDays: Number(expiresInDays),
      },
      {
        onSuccess: (res) => {
          setFreshToken(res.token);
          setShowForm(false);
          resetForm();
        },
      },
    );
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      pushToast({ kind: 'success', message: 'Token copied to clipboard' });
    } catch {
      pushToast({ kind: 'error', message: 'Could not copy — select and copy manually' });
    }
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.intro}>
          Tokens let scripts and integrations act in this workspace with the permission you choose.
        </div>
        <div className={styles.toolbarActions}>
          {!showForm && !freshToken && (
            <Button variant="primary" size="sm" icon="AddOutlined" onClick={() => setShowForm(true)}>
              New token
            </Button>
          )}
        </div>
      </div>

      {freshToken && (
        <div className={styles.reveal}>
          <div className={styles.revealHead}>
            <Icon name="TickCircleOutlined" size={16} />
            Copy your token now — you won't be able to see it again.
          </div>
          <div className={styles.revealRow}>
            <code className={styles.tokenCode}>{freshToken}</code>
            <Button variant="" size="sm" icon="CopyOutlined" onClick={copyToken}>
              Copy
            </Button>
            <IconButton icon="CloseOutlined" title="Dismiss" onClick={() => setFreshToken(null)} />
          </div>
        </div>
      )}

      {showForm && (
        <div className={styles.form}>
          <div className={styles.formGrid}>
            <label className={styles.fieldWide}>
              <span className={styles.fieldLabel}>Name</span>
              <TextInput
                dsVersion="2.0"
                leadingIcon={<KeyDiagonalOutlined />}
                placeholder="e.g. CI deploy bot"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Permission</span>
              <RoleSelect<AccessTokenPermission>
                value={permission}
                options={PERMISSION_OPTIONS}
                onChange={setPermission}
                renderValue={(p) => (
                  <Tag color={PERMISSION_COLOR[p]} size="small">
                    {PERMISSION_LABEL[p]}
                  </Tag>
                )}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Expires in</span>
              <RoleSelect<string>
                value={expiresInDays}
                options={EXPIRY_OPTIONS}
                onChange={setExpiresInDays}
                renderValue={(v) => <span>{EXPIRY_OPTIONS.find((o) => o.value === v)?.label}</span>}
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="TickSmallOutlined"
              disabled={!name.trim() || create.isPending}
              onClick={submit}
            >
              {create.isPending ? 'Creating…' : 'Create token'}
            </Button>
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <div className={styles.empty}>
          No access tokens yet. Create one to let scripts and integrations act in this workspace.
        </div>
      ) : (
        <div className={t.table}>
          <div className={cn(t.thead, TOKEN_GRID)}>
            <div className={t.th}>Name</div>
            <div className={t.th}>Permission</div>
            <div className={t.th}>Expires</div>
            <div className={t.th}>Status</div>
            <div className={cn(t.th, t.cellRight)}>Revoke</div>
          </div>
          {tokens.map((token) => {
            const status = statusOf(token);
            const inactive = status.label !== 'Active';
            return (
              <div key={token.id} className={cn(t.trow, TOKEN_GRID, inactive && styles.rowInactive)}>
                <div className={t.td}>
                  <div className={t.nm}>{token.name}</div>
                  <div className={t.rowSub}>
                    <code>{token.prefix}…</code> · created {formatDate(token.createdAt)}
                  </div>
                </div>
                <div className={t.td}>
                  <Tag color={PERMISSION_COLOR[token.permission]} size="small">
                    {PERMISSION_LABEL[token.permission]}
                  </Tag>
                </div>
                <div className={t.td}>{formatDate(token.expiresAt)}</div>
                <div className={t.td}>
                  <Tag color={status.tone} size="small">
                    {status.label}
                  </Tag>
                </div>
                <div className={cn(t.td, t.cellRight)}>
                  {inactive ? (
                    <span className={styles.cellDash}>—</span>
                  ) : (
                    <IconButton
                      icon="DeleteOutlined"
                      red
                      title="Revoke token"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(token.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
