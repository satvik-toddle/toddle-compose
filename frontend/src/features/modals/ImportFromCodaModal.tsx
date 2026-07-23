import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, SelectDropdown, TextInput } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import {
  useCodaImportCredentials,
  useCreateCodaImportJob,
  useValidateCodaImportUrl,
} from '../../hooks/useCodaImport';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import type { CodaImportValidateResult } from '../../types/api';

// react-select's union type drops the props we set; use it untyped, matching the
// other SelectDropdown call sites (ImportPageFromCodaModal, CopyToCodaModal).
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

const styles = {
  step: 'flex flex-col gap-3',
  label: 'mb-1.5 text-label uppercase text-secondary',
  empty:
    'rounded-2 border border-secondary bg-surface-secondary-enabled px-3.5 py-3 text-body text-secondary',
  info: 'flex flex-col gap-1 rounded-2 border border-secondary bg-surface-secondary-enabled px-3.5 py-3',
  docName: 'text-body font-weight-600 text-primary',
  pages: 'text-body-s text-secondary',
};

// Two-step "Import from Coda": paste a URL → Validate resolves the doc (name +
// page count) → confirm/prefill a new-workspace name → Import enqueues a job.
export function ImportFromCodaModal({ onClose }: Readonly<{ onClose: () => void }>) {
  const navigate = useNavigate();
  const { data: credentials } = useCodaImportCredentials();
  const validate = useValidateCodaImportUrl();
  const create = useCreateCodaImportJob();

  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [resolved, setResolved] = useState<CodaImportValidateResult | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Auto-select the sole credential once the list loads (mirrors ImportPageFromCodaModal).
  useEffect(() => {
    if (credentialId === null && credentials?.length === 1) {
      setCredentialId(credentials[0].id);
    }
  }, [credentials, credentialId]);

  const credentialOptions = useMemo(
    () =>
      (credentials ?? []).map((c) => ({
        value: c.id,
        label: `${c.label ?? 'Token'} ··· ${c.hint ?? '????'}`,
      })),
    [credentials],
  );
  const hasCredentials = (credentials?.length ?? 0) > 0;

  const runValidate = () => {
    const trimmed = url.trim();
    if (!trimmed || !credentialId || validate.isPending) return;
    setError(null);
    validate.mutate(
      { url: trimmed, credentialId },
      {
        onSuccess: (res) => {
          setResolved(res);
          // Prefill the workspace name from the import root (doc name, or page name for
          // a page-subtree import); editable.
          setWorkspaceName(res.rootName);
        },
        onError: (e) => setError(messageOf(e)),
      },
    );
  };

  const runImport = () => {
    if (!resolved || !workspaceName.trim() || !credentialId || create.isPending) return;
    create.mutate(
      {
        codaDocUrl: resolved.canonicalUrl,
        workspaceName: workspaceName.trim(),
        credentialId,
      },
      {
        onSuccess: () => {
          pushToast({ kind: 'success', message: 'Import started' });
          onClose();
          navigate('/admin/coda-import');
        },
      },
    );
  };

  // Return to the URL step to re-validate a different doc.
  const back = () => {
    setResolved(null);
    setError(null);
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="brand"
        icon="ImportOutlined"
        title="Import from Coda"
        sub="Bring a Coda doc — or a single page's subtree — into a new toddle-compose workspace."
        onClose={onClose}
      />
      <div className="m-body">
        {!resolved ? (
          <div className={styles.step}>
            <div>
              <div className={styles.label}>Coda token</div>
              {hasCredentials ? (
                <Select
                  options={credentialOptions}
                  value={credentialOptions.find((o) => o.value === credentialId) ?? null}
                  onChange={(opt: { value: string } | null) => {
                    setCredentialId(opt?.value ?? null);
                    setError(null);
                  }}
                  placeholder="Choose a Coda token"
                  size="small"
                  isSearchable={false}
                  isClearable={false}
                />
              ) : (
                <div className={styles.empty}>
                  No Coda tokens configured — add one in the Coda imports admin.
                </div>
              )}
            </div>
            <TextInput
              dsVersion="2.0"
              size="medium"
              label="Coda doc URL"
              placeholder="https://coda.io/d/…"
              value={url}
              autoFocus
              disabled={validate.isPending}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runValidate();
              }}
              aria-label="Coda doc URL"
            />
            {error && <Alert dsVersion="2.0" type="error" message={error} />}
          </div>
        ) : (
          <div className={styles.step}>
            <div className={styles.info}>
              <span className={styles.docName}>{resolved.rootName}</span>
              <span className={styles.pages}>
                {resolved.codaRootPageId ? 'Importing page subtree · ' : ''}
                {resolved.pageCount} {resolved.pageCount === 1 ? 'page' : 'pages'} will
                be imported
              </span>
            </div>
            <TextInput
              dsVersion="2.0"
              size="medium"
              label="Workspace name"
              placeholder="Workspace name"
              value={workspaceName}
              autoFocus
              disabled={create.isPending}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runImport();
              }}
              aria-label="toddle-compose workspace name"
            />
          </div>
        )}
      </div>
      <div className="m-foot">
        {resolved && (
          <Button
            variant="ghost"
            icon="ChevronLeftOutlined"
            disabled={create.isPending}
            onClick={back}
          >
            Back
          </Button>
        )}
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {!resolved ? (
          <Button
            variant="primary"
            disabled={!url.trim() || !credentialId || validate.isPending}
            onClick={runValidate}
          >
            {validate.isPending ? 'Validating…' : 'Validate'}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="ImportOutlined"
            disabled={!workspaceName.trim() || create.isPending}
            onClick={runImport}
          >
            {create.isPending ? 'Starting…' : 'Import'}
          </Button>
        )}
      </div>
    </Modal>
  );
}
