import { useMemo, useState, type ComponentType } from 'react';
import { SelectDropdown } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { Loader } from '../../components/Loader';
import { RoleRadios } from '../../components/RoleRadios';
import { useAddWorkspaceMember } from '../../hooks/useWorkspaceMemberMutations';
import { useRealmUserSearch } from '../../hooks/useRealmUserSearch';
import { useRealm, useWorkspaceMembers } from '../../hooks/queries';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { WS_ROLES, WS_ROLE_META, isRealmAdmin } from '../../lib/roles';
import type { WorkspaceRole } from '../../types/roles';

// The version-switching selector's union type drops some react-select props
// (value/onChange/filterOption); use it untyped like components/RoleSelect.tsx does.
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// One selectable realm user; `email` rides along for the add-member call.
interface UserOption {
  value: string;
  label: string;
  subtitle: string;
  icon: React.ReactElement;
  email: string;
}

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
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<UserOption | null>(null);
  const [role, setRole] = useState<WorkspaceRole>('EDIT');
  const { users, isSearching } = useRealmUserSearch(term);
  // Only admins reach this modal, so the members read is authorized.
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const { data: realm } = useRealm();
  // Only realm admins may grant the workspace Admin role.
  const roleChoices = isRealmAdmin(realm?.role) ? WS_ROLES : WS_ROLES.filter((r) => r !== 'ADMIN');

  // Realm-wide matches minus people who are already in this workspace.
  const options = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.userId));
    return users
      .filter((u) => !memberIds.has(u.id))
      .map(
        (u): UserOption => ({
          value: u.id,
          label: u.name,
          subtitle: u.email,
          icon: <Avatar person={{ name: u.name, color: u.color }} size={20} />,
          email: u.email,
        }),
      );
  }, [users, members]);

  const noResults = !!term.trim() && !isSearching && options.length === 0;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (add.isPending) return 'Adding…';
    return 'Add to workspace';
  }, [add.isPending]);

  const submit = () => {
    if (!selected || add.isPending) return;
    add.mutate({ workspaceId, email: selected.email, role }, { onSuccess: () => onClose() });
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
        title={`Add to ${workspaceName}`}
        sub="Search people in this realm by name or email."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Person">
          <Select
            options={options}
            value={selected}
            onChange={(opt: UserOption | null) => setSelected(opt)}
            onSearchTextChange={setTerm}
            // Results are already server-filtered (name OR email); react-select's
            // default label filter would wrongly drop email matches.
            filterOption={null}
            isSearchable
            isClearable
            placeholder="Search people…"
            noOptionsText={term.trim() ? 'No matching people in this realm' : 'No people to suggest'}
            loader={isSearching ? <Loader size={18} label="Searching" /> : undefined}
            size="small"
            testId="ws-member-search"
          />
        </Field>

        {noResults && (
          <div className="invite-fallback">
            <div>
              <div className="t">Can’t find them?</div>
              <div className="d">Send a link so they can create an account, then add them here.</div>
            </div>
            <Button size="sm" icon="SendOutlined" onClick={copyLink}>
              Copy sign-up link
            </Button>
          </div>
        )}
        {add.isError && (
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
            options={roleChoices.map((r) => ({
              value: r,
              desc: WS_ROLE_META[r].label,
            }))}
          />
        </Field>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="AddOutlined" disabled={!selected || add.isPending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
