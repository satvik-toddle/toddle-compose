import { useMemo } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { WSChip } from '../../components/WSChip';
import { useRemoveWorkspaceMember } from '../../hooks/useWorkspaceMemberMutations';
import { useRemoveRealmMember } from '../../hooks/useRealmMutations';
import type { WorkspaceRole } from '../../types/roles';

export function ConfirmRemoveMemberModal({
  onClose,
  scope,
  workspaceId,
  workspaceName,
  userId,
  name,
  email,
  role,
}: {
  onClose: () => void;
  scope: 'workspace' | 'realm';
  workspaceId?: string;
  workspaceName?: string;
  userId: string;
  name: string;
  email: string;
  role?: WorkspaceRole;
}) {
  const removeWs = useRemoveWorkspaceMember();
  const removeRealm = useRemoveRealmMember();
  const pending = removeWs.isPending || removeRealm.isPending;

  const submit = () => {
    if (pending) return;
    if (scope === 'workspace' && workspaceId) {
      removeWs.mutate({ workspaceId, userId }, { onSuccess: () => onClose() });
    } else {
      removeRealm.mutate(userId, { onSuccess: () => onClose() });
    }
  };

  const title = `Remove ${name}?`;
  const sub =
    scope === 'workspace'
      ? `They'll lose access to ${workspaceName ?? 'this workspace'} and everything shared inside it.`
      : 'They lose realm access and are removed from every workspace in it.';

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (pending) return 'Removing…';
    return scope === 'workspace' ? 'Remove from workspace' : 'Remove from realm';
  }, [pending, scope]);

  return (
    <Modal onClose={onClose}>
      <ModalHead tone="danger" icon="DeleteOutlined" title={title} sub={sub} onClose={onClose} />
      <div className="m-body">
        <div className="found">
          <Avatar person={{ name }} size={34} />
          <div style={{ flex: 1 }}>
            <div className="nm">{name}</div>
            <div className="sub">{email}</div>
          </div>
          {role && <WSChip role={role} />}
        </div>
        <div className="m-note">
          <Icon name="InformationOutlined" size={14} muted />
          {scope === 'workspace'
            ? "They keep their realm account and any other workspaces they're in."
            : 'This cannot be undone, but they can be re-added later.'}
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={pending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
