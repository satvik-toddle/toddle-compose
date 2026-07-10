import { useMemo, useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useDeleteWorkspace } from '../../hooks/useWorkspaceMutations';

export function ConfirmDeleteWorkspaceModal({
  onClose,
  workspaceId,
  name,
}: {
  onClose: () => void;
  workspaceId: string;
  name: string;
}) {
  const del = useDeleteWorkspace();
  const [text, setText] = useState('');
  const canDelete = text.trim() === name && !del.isPending;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (del.isPending) return 'Deleting…';
    return 'Delete workspace';
  }, [del.isPending]);

  const submit = () => {
    if (!canDelete) return;
    del.mutate(workspaceId, { onSuccess: () => onClose() });
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="danger"
        icon="DeleteOutlined"
        title={`Delete "${name}"?`}
        sub="This permanently deletes the workspace and all docs inside it. This can't be undone."
        onClose={onClose}
      />
      <div className="m-body">
        <div className="danger-box">
          <Icon name="WarningTriangleOutlined" size={14} red />
          <span>Members will lose access immediately.</span>
        </div>
        <Field label="Type the workspace name to confirm">
          <TextInput
            placeholder={name}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </Field>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" icon="DeleteOutlined" disabled={!canDelete} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
