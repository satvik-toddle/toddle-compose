import { useUiStore } from '../stores/uiStore';
import { CreateWorkspaceModal } from '../features/modals/CreateWorkspaceModal';
import { RenameWorkspaceModal } from '../features/modals/RenameWorkspaceModal';
import { AddRealmMemberModal } from '../features/modals/AddRealmMemberModal';
import { AddWorkspaceMemberModal } from '../features/modals/AddWorkspaceMemberModal';
import { WorkspaceSettingsModal } from '../features/modals/WorkspaceSettingsModal';
import { ConfirmDeleteWorkspaceModal } from '../features/modals/ConfirmDeleteWorkspaceModal';
import { ConfirmRemoveMemberModal } from '../features/modals/ConfirmRemoveMemberModal';
import { ConfirmDeletePageModal } from '../features/modals/ConfirmDeletePageModal';
import { ConfirmRestoreVersionModal } from '../features/modals/ConfirmRestoreVersionModal';
import { DocPermissionsModal } from '../features/modals/DocPermissionsModal';
import { CopyToCodaModal } from '../features/migration/CopyToCodaModal';

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
    case 'addWorkspaceMember':
      return (
        <AddWorkspaceMemberModal
          onClose={close}
          workspaceId={modal.workspaceId}
          workspaceName={modal.workspaceName}
        />
      );
    case 'workspaceSettings':
      return (
        <WorkspaceSettingsModal
          onClose={close}
          workspaceId={modal.workspaceId}
          workspaceName={modal.workspaceName}
          isAdmin={modal.isAdmin}
        />
      );
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
    case 'confirmDeletePage':
      return (
        <ConfirmDeletePageModal
          onClose={close}
          kind={modal.kind}
          workspaceId={modal.workspaceId}
          id={modal.id}
          name={modal.name}
        />
      );
    case 'confirmRestoreVersion':
      return (
        <ConfirmRestoreVersionModal
          onClose={close}
          docId={modal.docId}
          seq={modal.seq}
          versionLabel={modal.versionLabel}
        />
      );
    case 'docPermissions':
      return (
        <DocPermissionsModal
          onClose={close}
          docId={modal.docId}
          docTitle={modal.docTitle}
          owner={modal.owner}
        />
      );
    case 'copyToCoda':
      return (
        <CopyToCodaModal onClose={close} docId={modal.docId} workspaceId={modal.workspaceId} />
      );
    default:
      return null;
  }
}
