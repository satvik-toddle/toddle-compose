import { useMemo } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useDeleteDocument, useDeleteFolder } from '../../hooks/usePages';

export function ConfirmDeletePageModal({
  onClose,
  kind,
  workspaceId,
  id,
  name,
}: {
  onClose: () => void;
  kind: 'doc' | 'folder';
  workspaceId: string;
  id: string;
  name: string;
}) {
  const deleteDoc = useDeleteDocument();
  const deleteFolder = useDeleteFolder();
  const pending = deleteDoc.isPending || deleteFolder.isPending;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (pending) return 'Deleting…';
    return 'Delete';
  }, [pending]);

  const submit = () => {
    if (pending) return;
    if (kind === 'doc') {
      deleteDoc.mutate({ workspaceId, id }, { onSuccess: () => onClose() });
    } else {
      deleteFolder.mutate({ workspaceId, id }, { onSuccess: () => onClose() });
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="danger"
        icon="DeleteOutlined"
        title={`Delete ${kind === 'doc' ? 'page' : 'folder'} "${name}"?`}
        sub={
          kind === 'folder'
            ? 'The folder and the documents inside it will be removed.'
            : 'This page and all its sub-pages will be removed for everyone.'
        }
        onClose={onClose}
      />
      <div className="m-body">
        <div className="danger-box">
          <Icon name="WarningTriangleOutlined" size={14} red />
          <span>This can't be undone.</span>
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" icon="DeleteOutlined" disabled={pending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
