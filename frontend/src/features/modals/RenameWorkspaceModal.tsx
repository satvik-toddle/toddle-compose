import { useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useRenameWorkspace } from '../../hooks/useWorkspaceMutations';
import type { IconName } from '../../components/iconMap';

export function RenameWorkspaceModal({
  onClose,
  workspaceId,
  name: initialName,
  icon,
}: {
  onClose: () => void;
  workspaceId: string;
  name: string;
  icon: IconName;
}) {
  const rename = useRenameWorkspace();
  const [name, setName] = useState(initialName);

  const submit = () => {
    if (!name.trim() || rename.isPending) return;
    rename.mutate({ id: workspaceId, name: name.trim() }, { onSuccess: () => onClose() });
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        icon="PencilOutlined"
        title="Rename workspace"
        sub="This changes the name everywhere for all members."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Workspace name">
          <span className="inp inp-emoji">
            <span className="emoji-btn"><Icon name={icon} size={18} /></span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </span>
        </Field>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!name.trim() || rename.isPending} onClick={submit}>
          {rename.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
}
