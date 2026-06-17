import { useUiStore } from '../stores/uiStore';
import { CreateWorkspaceModal } from '../features/modals/CreateWorkspaceModal';
import { RenameWorkspaceModal } from '../features/modals/RenameWorkspaceModal';
import { AddRealmMemberModal } from '../features/modals/AddRealmMemberModal';
import { ConfirmDeleteWorkspaceModal } from '../features/modals/ConfirmDeleteWorkspaceModal';
import { ConfirmRemoveMemberModal } from '../features/modals/ConfirmRemoveMemberModal';

// Renders the active modal from the UI store. One mount point at the app root.
export function ModalRoot() {
  const modal = useUiStore((s) => s.modal);
  const close = useUiStore((s) => s.closeModal);
  if (!modal) return null;

  switch (modal.type) {
    case 'createWorkspace':
      return <CreateWorkspaceModal onClose={close} />;
    case 'renameWorkspace':
      return (
        <RenameWorkspaceModal
          onClose={close}
          workspaceId={modal.workspaceId}
          name={modal.name}
          icon={modal.icon}
        />
      );
    case 'addRealmMember':
      return <AddRealmMemberModal onClose={close} />;
    case 'confirmDeleteWorkspace':
      return (
        <ConfirmDeleteWorkspaceModal onClose={close} workspaceId={modal.workspaceId} name={modal.name} />
      );
    case 'confirmRemoveMember':
      return (
        <ConfirmRemoveMemberModal
          onClose={close}
          scope={modal.scope}
          workspaceId={modal.workspaceId}
          workspaceName={modal.workspaceName}
          userId={modal.userId}
          name={modal.name}
          email={modal.email}
          role={modal.role}
        />
      );
    default:
      return null;
  }
}
