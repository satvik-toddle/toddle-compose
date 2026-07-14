import { useMemo } from 'react';
import { Tag } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useRevokePersonalAccessToken } from '../../hooks/usePersonalAccessTokenMutations';
import type { PersonalAccessToken } from '../../types/api';

export function ConfirmRevokeTokenModal({
  onClose,
  token,
}: {
  onClose: () => void;
  token: PersonalAccessToken;
}) {
  const revoke = useRevokePersonalAccessToken();

  const submit = () => {
    if (revoke.isPending) return;
    revoke.mutate(token.id, { onSuccess: () => onClose() });
  };

  // Centralised so additional states (e.g. retrying) can be added here later.
  const submitButtonLabel = useMemo(
    () => (revoke.isPending ? 'Revoking…' : 'Revoke token'),
    [revoke.isPending],
  );

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="danger"
        icon="DeleteOutlined"
        title={`Revoke "${token.name}"?`}
        sub="Anything using this token loses access immediately."
        onClose={onClose}
      />
      <div className="m-body">
        <div className="found">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'var(--surface-tertiary-enabled)',
            }}
          >
            <Icon name="KeyDiagonalOutlined" size={16} muted />
          </span>
          <div style={{ flex: 1 }}>
            <div className="nm">{token.name}</div>
            <div className="sub">
              <code>{token.prefix}…</code>
            </div>
          </div>
          <Tag color="neutral" size="small">
            {token.permission}
          </Tag>
        </div>
        <div className="m-note">
          <Icon name="InformationOutlined" size={14} muted />
          This can't be undone. Any scripts or integrations using it will stop working — issue a new
          token to restore access.
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={revoke.isPending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
