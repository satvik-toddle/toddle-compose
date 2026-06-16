import { useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { useRenameDocument, useRenameFolder } from '../../hooks/usePages';

export function RenamePageModal({
  onClose,
  kind,
  workspaceId,
  id,
  name: initialName,
}: {
  onClose: () => void;
  kind: 'doc' | 'folder';
  workspaceId: string;
  id: string;
  name: string;
}) {
  const renameDoc = useRenameDocument();
  const renameFolder = useRenameFolder();
  const [name, setName] = useState(initialName);
  const pending = renameDoc.isPending || renameFolder.isPending;
  const label = kind === 'doc' ? 'page' : 'folder';

  const submit = () => {
    if (!name.trim() || pending) return;
    if (kind === 'doc') {
      renameDoc.mutate({ workspaceId, id, title: name.trim() }, { onSuccess: () => onClose() });
    } else {
      renameFolder.mutate({ workspaceId, id, name: name.trim() }, { onSuccess: () => onClose() });
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead icon="PencilOutlined" title={`Rename ${label}`} onClose={onClose} />
      <div className="m-body">
        <Field label={kind === 'doc' ? 'Page name' : 'Folder name'}>
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
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
