import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Alert, SelectDropdown, SpinnerLoader, TextInput } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/Loader';
import { useImportPageFromCoda, useMigrationScopes } from '../../hooks/useMigrations';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';

// react-select's union type drops the props we set; use it untyped, matching CopyToCodaModal.
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

const styles = {
  step: 'flex flex-col gap-3',
  label: 'mb-1.5 text-label uppercase text-secondary',
  empty:
    'rounded-2 border border-secondary bg-surface-secondary-enabled px-3.5 py-3 text-body text-secondary',
  spinner: 'inline-flex items-center gap-1.5',
};

// "Import from Coda" (per-doc): destructively overwrite the current page's body with an
// in-scope Coda page's content. Reuses the same workspace scopes list as Copy to Coda.
export function ImportPageFromCodaModal({
  onClose,
  docId,
  workspaceId,
}: Readonly<{ onClose: () => void; docId: string; workspaceId: string }>) {
  const { data: scopes, isLoading: scopesLoading } = useMigrationScopes(workspaceId);
  const importPage = useImportPageFromCoda(docId);

  const [scopeId, setScopeId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Auto-select the sole/first destination once scopes load (mirrors CopyToCodaModal).
  useEffect(() => {
    if (scopeId === null && scopes && scopes.length > 0) setScopeId(scopes[0].id);
  }, [scopes, scopeId]);

  const scopeOptions = useMemo(
    () => (scopes ?? []).map((s) => ({ value: s.id, label: s.label })),
    [scopes],
  );
  const hasScopes = (scopes?.length ?? 0) > 0;
  const canImport = !!scopeId && url.trim() !== '' && !importPage.isPending;

  const runImport = () => {
    if (!scopeId || !url.trim() || importPage.isPending) return;
    setError(null);
    importPage.mutate(
      { scopeId, url: url.trim() },
      {
        onSuccess: (res) => {
          const msg =
            res.losses.length > 0
              ? `Page imported — ${res.losses.length} fidelity note${res.losses.length === 1 ? '' : 's'}`
              : 'Page imported from Coda';
          pushToast({ kind: 'success', message: msg });
          onClose();
        },
        onError: (e) => setError(messageOf(e)),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="danger"
        icon="ImportOutlined"
        title="Import from Coda"
        sub="Replace this page's content with a Coda page."
        onClose={onClose}
      />
      <div className="m-body">
        <div className={styles.step}>
          <div>
            <div className={styles.label}>Source destination</div>
            {scopesLoading ? (
              <PageLoader />
            ) : hasScopes ? (
              <Select
                options={scopeOptions}
                value={scopeOptions.find((o) => o.value === scopeId) ?? null}
                onChange={(opt: { value: string } | null) => {
                  setScopeId(opt?.value ?? null);
                  setError(null);
                }}
                placeholder="Choose a Coda destination"
                size="small"
                isSearchable={false}
                isClearable={false}
              />
            ) : (
              <div className={styles.empty}>
                No Coda destinations configured. Ask a realm admin to add one in Admin → Migrations.
              </div>
            )}
          </div>

          <TextInput
            dsVersion="2.0"
            size="medium"
            label="Coda page URL"
            placeholder="https://coda.io/d/…"
            value={url}
            disabled={importPage.isPending}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runImport();
            }}
            aria-label="Coda page URL"
          />

          <Alert
            dsVersion="2.0"
            type="warning"
            message="This replaces the entire current document content and can't be undone."
          />
          {error && <Alert dsVersion="2.0" type="error" message={error} />}
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose} disabled={importPage.isPending}>
          Cancel
        </Button>
        <Button variant="danger" icon="ImportOutlined" disabled={!canImport} onClick={runImport}>
          {importPage.isPending ? (
            <span className={styles.spinner}>
              <SpinnerLoader size="xxx-small" variant="default" />
              Importing…
            </span>
          ) : (
            'Import'
          )}
        </Button>
      </div>
    </Modal>
  );
}
