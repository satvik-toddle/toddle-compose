import { useMemo, useState } from 'react';
import { TextInput, Tag } from '@toddle-edu/ds-web';
import { KeyDiagonalOutlined } from '@toddle-edu/ds-icons';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { RoleSelect } from '../../components/RoleSelect';
import { EmptyState } from '../../components/EmptyState';
import { PageLoader } from '../../components/Loader';
import { useAccessTokens } from '../../hooks/queries';
import { useCreateAccessToken, useRevokeAccessToken } from '../../hooks/useAccessTokenMutations';
import { pushToast } from '../../stores/uiStore';
import { useWorkspaceCtx } from './WorkspaceLayout';
import s from './AccessTokensPanel.module.scss';
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
const PERMISSION_COLOR: Record<AccessTokenPermission, string> = {
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

// A revoked token stays in the list (audit trail) but reads as inactive; an
// expired one likewise. Everything else is live.
function statusOf(t: AccessToken): { label: string; tone: string } {
  if (t.revokedAt) return { label: 'Revoked', tone: 'neutral' };
  if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
    return { label: 'Expired', tone: 'neutral' };
  return { label: 'Active', tone: 'green' };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function AccessTokensPanel() {
  const ctx = useWorkspaceCtx();
  const { data: allTokens, isLoading } = useAccessTokens(ctx.isAdmin);
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
    () =>
      (allTokens ?? []).filter(
        (t) => t.scope === 'WORKSPACE' && t.workspaceId === ctx.workspaceId,
      ),
    [allTokens, ctx.workspaceId],
  );

  if (!ctx.isAdmin) {
    return (
      <main className="ws-main">
        <div className="ws-crumbbar">
          <div className="ws-crumbs">
            <span>{ctx.name}</span>
            <span className="sep">/</span>
            <span className="cur">🔑 Access tokens</span>
          </div>
        </div>
        <div className="ws-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState
            glyph={<Icon name="LockOutlined" size={24} muted style={{ width: 36, height: 36 }} />}
            title="Access tokens are managed by admins"
          >
            Only workspace admins can create access tokens here.
          </EmptyState>
        </div>
      </main>
    );
  }

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
        workspaceId: ctx.workspaceId,
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

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span>{ctx.name}</span>
          <span className="sep">/</span>
          <span className="cur">🔑 Access tokens</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="AddOutlined"
          onClick={() => {
            setShowForm((v) => !v);
            setFreshToken(null);
          }}
        >
          New token
        </Button>
      </div>

      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>
            🔑
          </span>
          <div>
            <h1>Access tokens</h1>
            <div className="sub">
              Programmatic access to {ctx.name}. Tokens act with the permission you choose — treat
              them like passwords.
            </div>
          </div>
        </div>

        {freshToken && (
          <div className={s.reveal}>
            <div className={s.revealHead}>
              <Icon name="TickCircleOutlined" size={16} />
              <span>Copy your token now — you won't be able to see it again.</span>
            </div>
            <div className={s.revealRow}>
              <code className={s.tokenCode}>{freshToken}</code>
              <Button variant="" size="sm" icon="CopyOutlined" onClick={copyToken}>
                Copy
              </Button>
              <IconButton icon="CloseOutlined" title="Dismiss" onClick={() => setFreshToken(null)} />
            </div>
          </div>
        )}

        {showForm && (
          <div className={s.form}>
            <div className={s.formGrid}>
              <label className={s.field}>
                <span className={s.label}>Name</span>
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
              <label className={s.field}>
                <span className={s.label}>Permission</span>
                <RoleSelect<AccessTokenPermission>
                  value={permission}
                  options={PERMISSION_OPTIONS}
                  onChange={setPermission}
                  renderValue={(p) => (
                    <Tag color={PERMISSION_COLOR[p] as any} size="small">
                      {PERMISSION_LABEL[p]}
                    </Tag>
                  )}
                />
              </label>
              <label className={s.field}>
                <span className={s.label}>Expires in</span>
                <RoleSelect<string>
                  value={expiresInDays}
                  options={EXPIRY_OPTIONS}
                  onChange={setExpiresInDays}
                  renderValue={(v) => <span>{EXPIRY_OPTIONS.find((o) => o.value === v)?.label}</span>}
                />
              </label>
            </div>
            <div className={s.formActions}>
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

        {isLoading ? (
          <PageLoader />
        ) : tokens.length === 0 ? (
          <div style={{ paddingTop: 24 }}>
            <EmptyState
              glyph="🔑"
              title="No access tokens yet"
              actions={
                !showForm ? (
                  <Button variant="primary" size="sm" icon="AddOutlined" onClick={() => setShowForm(true)}>
                    Create a token
                  </Button>
                ) : undefined
              }
            >
              Create a token to let scripts and integrations act in this workspace.
            </EmptyState>
          </div>
        ) : (
          <div className={`tbl ${s.tokenTbl}`}>
            <div className="thead">
              <div>Name</div>
              <div>Permission</div>
              <div>Expires</div>
              <div>Status</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {tokens.map((t) => {
              const status = statusOf(t);
              const inactive = status.label !== 'Active';
              return (
                <div key={t.id} className="trow" style={inactive ? { opacity: 0.6 } : undefined}>
                  <div className="cell-main">
                    <span className={s.tokenIcon}>
                      <Icon name="KeyDiagonalOutlined" size={16} muted />
                    </span>
                    <div>
                      <div className="nm">{t.name}</div>
                      <div className="sub">
                        <code>{t.prefix}…</code> · created {fmtDate(t.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Tag color={PERMISSION_COLOR[t.permission] as any} size="small">
                      {PERMISSION_LABEL[t.permission]}
                    </Tag>
                  </div>
                  <div>{fmtDate(t.expiresAt)}</div>
                  <div>
                    <Tag color={status.tone as any} size="small">
                      {status.label}
                    </Tag>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {inactive ? (
                      <span className="sub">—</span>
                    ) : (
                      <IconButton
                        icon="DeleteOutlined"
                        red
                        title="Revoke token"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(t.id)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
