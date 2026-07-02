import { useMemo, useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { useRenameDocument } from '../../hooks/usePages';

export function RenamePageModal({
  onClose,
  workspaceId,
  id,
  name: initialName,
}: {
  onClose: () => void;
  workspaceId: string;
  id: string;
  name: string;
}) {
  const renameDoc = useRenameDocument();
  const [name, setName] = useState(initialName);
  const pending = renameDoc.isPending;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (pending) return 'Saving…';
    return 'Save';
  }, [pending]);

  const submit = () => {
    if (!name.trim() || pending) return;
    renameDoc.mutate({ workspaceId, id, title: name.trim() }, { onSuccess: () => onClose() });
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead icon="PencilOutlined" title="Rename page" onClose={onClose} />
      <div className="m-body">
        <Field label="Page name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <Button variant="primary" disabled={!name.trim() || pending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
