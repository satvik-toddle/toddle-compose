import { useMemo, useState, type ComponentType } from 'react';
import { SelectDropdown } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { RoleSelect } from '../../components/RoleSelect';
import {
  useDocPermissions,
  useAddDocPermission,
  useUpdateDocPermission,
  useRemoveDocPermission,
} from '../../hooks/useDocPermissions';
import { useRealmUserSearch } from '../../hooks/useRealmUserSearch';
import { Loader } from '../../components/Loader';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { WS_ROLE_META, WS_ROLE_OPTIONS } from '../../lib/roles';
import type { WorkspaceRole } from '../../types/roles';

// The version-switching selector's union type drops react-select props (isMulti/value/onChange); use untyped like RoleSelect.tsx.
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// One selectable realm user; `email` rides along for the grant API call.
interface MemberOption {
  value: string;
  label: string;
  subtitle: string;
  icon: React.ReactElement;
  email: string;
}

const styles = {
  invite: 'flex flex-col gap-2',
  inviteRow: 'flex items-start gap-2',
  selectWrap: 'flex-1 min-w-0',
  errorText: 'flex items-center gap-1.5 text-body-s text-semantic-error',
  peopleHead: 'mb-1.5 text-body-xs font-semibold text-secondary',
  empty: 'py-2 text-body-s text-secondary',
  row: 'flex items-center gap-2.5 py-2',
  rowWho: 'flex-1 min-w-0',
  rowName: 'truncate text-body-s font-medium text-primary',
  rowEmail: 'truncate text-body-xs text-secondary',
  removeBtn:
    'flex h-6.5 w-6.5 flex-none cursor-pointer items-center justify-center rounded-1.5 border-0 bg-transparent hover:bg-surface-secondary-hover',
  note: 'flex items-center gap-1.5 text-body-xs text-secondary',
};

// Per-page grants for one document (multi-select of members + role) — unlike the workspace Share modal, page-only, no sub-pages.
export function DocPermissionsModal({
  onClose,
  docId,
  docTitle,
  ownerId,
}: {
  onClose: () => void;
  workspaceId: string; // accepted for ModalRoot parity; search is realm-wide
  docId: string;
  docTitle: string;
  ownerId: string;
}) {
  const { data: grants = [] } = useDocPermissions(docId);
  const addPermission = useAddDocPermission();
  const updatePermission = useUpdateDocPermission();
  const removePermission = useRemoveDocPermission();

  // Realm-wide directory search (any-realm-member gate, so doc-ADMIN guests can use it too).
  const [term, setTerm] = useState('');
  const { users, isSearching } = useRealmUserSearch(term);

  const [selected, setSelected] = useState<MemberOption[]>([]);
  const [role, setRole] = useState<WorkspaceRole>('EDIT');
  const [adding, setAdding] = useState(false);
  const [addErrors, setAddErrors] = useState<{ name: string; message: string }[]>([]);

  // Realm-wide matches except the owner (always has full access) and existing grantees.
  const options = useMemo(() => {
    const granted = new Set(grants.map((g) => g.userId));
    return users
      .filter((u) => u.id !== ownerId && !granted.has(u.id))
      .map(
        (u): MemberOption => ({
          value: u.id,
          label: u.name,
          subtitle: u.email,
          icon: <Avatar person={{ name: u.name, color: u.color }} size={20} />,
          email: u.email,
        }),
      );
  }, [users, grants, ownerId]);

  const add = async () => {
    if (selected.length === 0 || adding) return;
    setAdding(true);
    setAddErrors([]);
    const failed: MemberOption[] = [];
    const errors: { name: string; message: string }[] = [];
    // The endpoint grants one user at a time, so post the selection sequentially.
    for (const opt of selected) {
      try {
        await addPermission.mutateAsync({ docId, email: opt.email, role });
      } catch (e) {
        failed.push(opt);
        errors.push({ name: opt.label, message: messageOf(e) });
      }
    }
    setAdding(false);
    // Keep only the failed selections so a retry doesn't re-grant the successes.
    setSelected(failed);
    setAddErrors(errors);
    if (errors.length === 0) {
      const n = selected.length;
      pushToast({ kind: 'success', message: `Access granted to ${n} ${n === 1 ? 'person' : 'people'}` });
    }
  };

  const renderRole = (v: WorkspaceRole) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Icon name={WS_ROLE_META[v].icon as IconName} size={14} muted />
      {WS_ROLE_META[v].label}
    </span>
  );

  const addButtonLabel = useMemo(() => {
    if (adding) return '…';
    return 'Add';
  }, [adding]);

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        icon="LockOutlined"
        title="Share"
        sub={`“${docTitle}” — search people in this realm by name or email; access applies to this page only.`}
        onClose={onClose}
      />
      <div className="m-body">
        {/* Grant to selected realm users */}
        <div className={styles.invite}>
          <div className={styles.inviteRow}>
            <div className={styles.selectWrap}>
              <Select
                isMulti
                options={options}
                value={selected}
                onChange={(opts: MemberOption[] | null) => {
                  setSelected(opts ?? []);
                  setAddErrors([]);
                }}
                onSearchTextChange={setTerm}
                // Results are already server-filtered (name OR email); react-select's
                // default label filter would wrongly drop email matches.
                filterOption={null}
                placeholder="Search people…"
                noOptionsText={term.trim() ? 'No matching people in this realm' : 'No people to suggest'}
                loader={isSearching ? <Loader size={18} label="Searching" /> : undefined}
                size="small"
                testId="doc-perm-users"
                error={addErrors.length > 0 ? ' ' : undefined}
              />
            </div>
            <RoleSelect<WorkspaceRole>
              value={role}
              onChange={setRole}
              options={WS_ROLE_OPTIONS}
              renderValue={renderRole}
            />
            <Button
              variant="primary"
              size="sm"
              icon="AddOutlined"
              disabled={selected.length === 0 || adding}
              onClick={add}
            >
              {addButtonLabel}
            </Button>
          </div>
          {addErrors.map((err) => (
            <div key={err.name} className={styles.errorText}>
              <Icon name="WarningTriangleOutlined" size={14} />
              {err.name}: {err.message}
            </div>
          ))}
        </div>

        {/* Grantees */}
        <div>
          <div className={styles.peopleHead}>People with access to this page</div>
          {grants.length === 0 && <div className={styles.empty}>No page-specific access yet.</div>}
          {grants.map((g) => (
            <div key={g.userId} className={styles.row}>
              <Avatar person={{ name: g.user.name, color: g.user.color }} size={28} />
              <div className={styles.rowWho}>
                <div className={styles.rowName}>{g.user.name}</div>
                <div className={styles.rowEmail}>{g.user.email}</div>
              </div>
              <RoleSelect<WorkspaceRole>
                value={g.role}
                onChange={(r) => updatePermission.mutate({ docId, userId: g.userId, role: r })}
                options={WS_ROLE_OPTIONS}
                renderValue={renderRole}
              />
              <button
                className={styles.removeBtn}
                title="Remove access"
                disabled={removePermission.isPending}
                onClick={() => removePermission.mutate({ docId, userId: g.userId })}
              >
                <Icon name="CloseOutlined" size={14} muted />
              </button>
            </div>
          ))}
        </div>

        <div className={styles.note}>
          <Icon name="InformationOutlined" size={14} muted />
          Grants apply to this page only — not its sub-pages.
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
