import { useMemo, useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { RoleRadios } from '../../components/RoleRadios';
import { useAddRealmMember } from '../../hooks/useRealmMutations';
import { isNotFound, messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import type { RealmRole } from '../../types/roles';

type AssignableRealmRole = Exclude<RealmRole, 'OWNER'>;

export function AddRealmMemberModal({ onClose }: { onClose: () => void }) {
  const add = useAddRealmMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRealmRole>('MEMBER');
  const notFound = isNotFound(add.error);

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (add.isPending) return 'Adding…';
    return 'Add to realm';
  }, [add.isPending]);

  const submit = () => {
    if (!email.trim() || add.isPending) return;
    add.mutate({ email: email.trim(), role }, { onSuccess: () => onClose() });
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
        icon="MultipleUsersOutlined"
        title="Add realm member"
        sub="Add an existing Toddle account to the realm by email."
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

        <Field label="Realm role">
          <RoleRadios<AssignableRealmRole>
            value={role}
            onChange={setRole}
            options={[
              { value: 'MAINTAINER', title: 'Maintainer', desc: 'Manage workspaces & realm members' },
              { value: 'MEMBER', title: 'Member', desc: 'Access only what their workspace roles allow' },
            ]}
          />
        </Field>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="AddOutlined" disabled={!email.trim() || add.isPending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
