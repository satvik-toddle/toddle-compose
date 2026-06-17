import { useUiStore } from '../stores/uiStore';
import { CreateWorkspaceModal } from '../features/modals/CreateWorkspaceModal';

// Renders the active modal from the UI store. One mount point at the app root.
export function ModalRoot() {
  const modal = useUiStore((s) => s.modal);
  const close = useUiStore((s) => s.closeModal);
  if (!modal) return null;

  switch (modal.type) {
    case 'createWorkspace':
      return <CreateWorkspaceModal onClose={close} />;
    default:
      return null;
  }
}
