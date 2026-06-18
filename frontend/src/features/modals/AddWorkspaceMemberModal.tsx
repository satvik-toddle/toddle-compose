import { useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { WSChip } from '../../components/WSChip';
import { RoleRadios } from '../../components/RoleRadios';
import { useAddWorkspaceMember } from '../../hooks/useWorkspaceMemberMutations';
import { isNotFound, messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import type { WorkspaceRole } from '../../types/roles';

export function AddWorkspaceMemberModal({
  onClose,
  workspaceId,
  workspaceName,
}: {
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
}) {
  const add = useAddWorkspaceMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('EDIT');
  const notFound = isNotFound(add.error);

  const submit = () => {
    if (!email.trim() || add.isPending) return;
    add.mutate({ workspaceId, email: email.trim(), role }, { onSuccess: () => onClose() });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register`);
      pushToast({ kind: 'success', message: 'Sign-up link copied' });
    } catch {
      pushToast({ kind: 'error', message: 'Could not copy the link' });
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        icon="AddOutlined"
        title={`Add to ${workspaceName}`}
        sub="Give someone access to this workspace by email."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Email address">
          <TextInput
            icon="EmailOutlined"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            err={add.isError}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </Field>

        {notFound && (
          <>
            <div className="err-text">
              <Icon name="WarningTriangleOutlined" size={14} />
              No user with that email — they must register first.
            </div>
            <div className="invite-fallback">
              <div>
                <div className="t">Want them to join?</div>
                <div className="d">Send a link so they can create an account, then add them here.</div>
              </div>
              <Button size="sm" icon="SendOutlined" onClick={copyLink}>
                Copy sign-up link
              </Button>
            </div>
          </>
        )}
        {add.isError && !notFound && (
          <div className="err-text">
            <Icon name="WarningTriangleOutlined" size={14} />
            {messageOf(add.error)}
          </div>
        )}

        <Field label="Workspace role">
          <RoleRadios<WorkspaceRole>
            cols
            value={role}
            onChange={setRole}
            options={WS_ROLES.map((r) => ({
              value: r,
              chip: <WSChip role={r} />,
              desc: WS_ROLE_META[r].desc,
            }))}
          />
        </Field>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="AddOutlined" disabled={!email.trim() || add.isPending} onClick={submit}>
          {add.isPending ? 'Adding…' : 'Add to workspace'}
        </Button>
      </div>
    </Modal>
  );
}
