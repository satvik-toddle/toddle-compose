import { useMemo, useState, type ComponentType } from 'react';
import { Alert, SelectDropdown } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { useCreateScope, useUpdateScope } from '../../hooks/useMigrations';
import { useWorkspaces } from '../../hooks/queries';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import type { MigrationScope, MigrationScopeTokenInput } from '../../types/api';

// react-select's union type drops the props we set; use it untyped, matching the
// other SelectDropdown call sites (CopyToCodaModal, RoleSelect, DocPermissionsModal).
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// A plaintext token row in the form (write-only — existing tokens are never pre-filled).
interface TokenDraft {
  key: number;
  token: string;
  label: string;
}

const styles = {
  tokens: 'flex flex-col gap-2.5',
  tokenRow: 'flex items-start gap-2',
  tokenSecret: 'flex-1 min-w-0',
  tokenLabel: 'w-[130px] shrink-0',
  chips: 'flex flex-col gap-1.5',
  chip: 'flex items-center gap-2 rounded-2 border border-secondary bg-surface-secondary-enabled px-2.5 py-1.5',
  chipMask: 'text-body text-primary tabular-nums',
  chipLabel: 'truncate text-body text-secondary',
  chipGap: 'ml-auto',
  addBtn: 'self-start',
  note: 'flex items-start gap-2 text-body text-secondary',
  readonly: 'rounded-2 border border-secondary bg-surface-secondary-enabled px-3 py-2 text-body text-secondary',
};

export function MigrationScopeFormModal({
  onClose,
  scope,
}: Readonly<{ onClose: () => void; scope?: MigrationScope }>) {
  const isEdit = !!scope;
  const create = useCreateScope();
  const update = useUpdateScope();
  const { data: workspaces = [] } = useWorkspaces();

  const [label, setLabel] = useState(scope?.label ?? '');
  const [workspaceId, setWorkspaceId] = useState<string | null>(scope?.workspaceId ?? null);
  const [codaUrl, setCodaUrl] = useState('');
  const [nextKey, setNextKey] = useState(1);
  const [newTokens, setNewTokens] = useState<TokenDraft[]>(
    isEdit ? [] : [{ key: 0, token: '', label: '' }],
  );
  // Ids of already-saved tokens the admin has removed (edit only).
  const [removedTokenIds, setRemovedTokenIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pending = create.isPending || update.isPending;

  const workspaceOptions = useMemo(
    () => workspaces.map((w) => ({ value: w.id, label: w.name })),
    [workspaces],
  );
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name;

  const keptTokens = (scope?.tokens ?? []).filter((t) => !removedTokenIds.has(t.id));
  const filledNewTokens = newTokens.filter((t) => t.token.trim());
  const totalTokens = keptTokens.length + filledNewTokens.length;

  const canSubmit = isEdit
    ? !!label.trim() && totalTokens >= 1 && !pending
    : !!label.trim() && !!workspaceId && !!codaUrl.trim() && filledNewTokens.length >= 1 && !pending;

  const addTokenRow = () => {
    setNewTokens((prev) => [...prev, { key: nextKey, token: '', label: '' }]);
    setNextKey((k) => k + 1);
  };
  const patchTokenRow = (key: number, patch: Partial<TokenDraft>) =>
    setNewTokens((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const removeTokenRow = (key: number) =>
    setNewTokens((prev) => prev.filter((t) => t.key !== key));
  const removeSavedToken = (id: string) =>
    setRemovedTokenIds((prev) => new Set(prev).add(id));

  const tokenInputs: MigrationScopeTokenInput[] = filledNewTokens.map((t) => ({
    token: t.token.trim(),
    ...(t.label.trim() ? { label: t.label.trim() } : {}),
  }));

  const submit = () => {
    if (!canSubmit) return;
    setErrorMsg(null);
    const onError = (err: unknown) => setErrorMsg(messageOf(err));

    if (isEdit && scope) {
      update.mutate(
        {
          id: scope.id,
          body: {
            ...(label.trim() !== scope.label ? { label: label.trim() } : {}),
            ...(tokenInputs.length ? { addTokens: tokenInputs } : {}),
            ...(removedTokenIds.size ? { removeTokenIds: [...removedTokenIds] } : {}),
          },
        },
        {
          onSuccess: () => {
            pushToast({ kind: 'success', message: 'Destination updated' });
            onClose();
          },
          onError,
        },
      );
      return;
    }

    if (!workspaceId) return;
    create.mutate(
      { workspaceId, label: label.trim(), codaUrl: codaUrl.trim(), tokens: tokenInputs },
      {
        onSuccess: () => {
          pushToast({ kind: 'success', message: 'Destination added' });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        tone="brand"
        icon={isEdit ? 'PencilOutlined' : 'AddOutlined'}
        title={isEdit ? 'Edit destination' : 'Add destination'}
        sub="A Coda location migrations may write into, plus the token(s) that authorize the writes."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Name">
          <TextInput
            placeholder="e.g. Product wiki"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Workspace">
          {isEdit ? (
            <div className={styles.readonly}>{workspaceName ?? scope?.workspaceId}</div>
          ) : (
            <Select
              options={workspaceOptions}
              value={workspaceOptions.find((o) => o.value === workspaceId) ?? null}
              onChange={(opt: { value: string } | null) => setWorkspaceId(opt?.value ?? null)}
              placeholder="Choose a workspace"
              size="small"
              isClearable={false}
            />
          )}
        </Field>

        <Field
          label="Coda URL"
          hint={isEdit ? undefined : 'A whole Coda doc URL, or a specific page inside it to nest under.'}
        >
          {isEdit ? (
            <div className={styles.readonly}>
              {scope?.codaRootUrl}
              {' · '}
              {scope?.codaRootPageId ? 'page root' : 'whole doc'}
            </div>
          ) : (
            <TextInput
              placeholder="https://coda.io/d/…"
              value={codaUrl}
              onChange={(e) => setCodaUrl(e.target.value)}
            />
          )}
        </Field>

        <Field label="Coda tokens">
          <div className={styles.tokens}>
            {isEdit && keptTokens.length > 0 && (
              <div className={styles.chips}>
                {keptTokens.map((t) => (
                  <div key={t.id} className={styles.chip}>
                    <span className={styles.chipMask}>••••{t.hint ?? '????'}</span>
                    {t.label && <span className={styles.chipLabel}>{t.label}</span>}
                    <span className={styles.chipGap} />
                    <IconButton
                      icon="CloseOutlined"
                      iconSize={14}
                      sm
                      title="Remove token"
                      aria-label="Remove saved token"
                      onClick={() => removeSavedToken(t.id)}
                    />
                  </div>
                ))}
              </div>
            )}

            {newTokens.map((t) => (
              <div key={t.key} className={styles.tokenRow}>
                <span className={styles.tokenSecret}>
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    placeholder="Paste a Coda API token"
                    value={t.token}
                    onChange={(e) => patchTokenRow(t.key, { token: e.target.value })}
                  />
                </span>
                <span className={styles.tokenLabel}>
                  <TextInput
                    placeholder="Label (optional)"
                    value={t.label}
                    onChange={(e) => patchTokenRow(t.key, { label: e.target.value })}
                  />
                </span>
                <IconButton
                  icon="DeleteOutlined"
                  iconSize={14}
                  sm
                  title="Remove token"
                  aria-label="Remove token row"
                  disabled={!isEdit && newTokens.length === 1}
                  onClick={() => removeTokenRow(t.key)}
                />
              </div>
            ))}

            <Button size="sm" icon="AddOutlined" className={styles.addBtn} onClick={addTokenRow}>
              Add token
            </Button>

            <div className={styles.note}>
              <Icon name="InformationOutlined" size={14} muted />
              <span>
                Each token is a distinct Coda user with edit access to the doc. Adding more tokens
                raises throughput — Coda rate-limits writes per user, so the pool is used in
                parallel.
              </span>
            </div>
          </div>
        </Field>

        {errorMsg && <Alert dsVersion="2.0" type="error" message={errorMsg} />}
      </div>

      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={isEdit ? 'TickSmallOutlined' : 'AddOutlined'}
          disabled={!canSubmit}
          onClick={submit}
        >
          {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add destination'}
        </Button>
      </div>
    </Modal>
  );
}
