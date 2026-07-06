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
import {
  useShareLink,
  usePutShareLink,
  useRegenerateShareLink,
  useDeleteShareLink,
} from '../../hooks/useShareLink';
import { useRealmUserSearch } from '../../hooks/useRealmUserSearch';
import { Loader } from '../../components/Loader';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { WS_ROLE_META, WS_ROLE_OPTIONS } from '../../lib/roles';
import type { WorkspaceRole } from '../../types/roles';
import type { ShareLinkScope } from '../../types/api';

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

// Link roles are a subset of workspace roles (never ADMIN via a link).
const LINK_ROLE_OPTIONS = (['READ', 'COMMENT', 'EDIT'] as WorkspaceRole[]).map((r) => ({
  value: r,
  label: WS_ROLE_META[r].label,
}));

const SCOPE_OPTIONS: { value: ShareLinkScope; label: string }[] = [
  { value: 'REALM', label: 'Anyone in the realm with the link' },
  { value: 'ANYONE', label: 'Anyone with the link (no sign-in)' },
];

const styles = {
  section: 'flex flex-col gap-2',
  sectionHead: 'flex items-center justify-between',
  sectionTitle: 'flex items-center gap-1.5 text-body-s font-semibold text-primary',
  divider: 'my-4 border-t border-secondary',
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
  linkControls: 'flex items-center gap-2',
  linkUrlRow: 'flex items-center gap-2',
  linkUrl:
    'flex-1 min-w-0 truncate rounded-1.5 border border-secondary bg-surface-secondary-enabled px-2.5 py-1.5 text-body-s text-secondary',
  warn: 'flex items-center gap-1.5 text-body-xs text-semantic-warning',
  linkActions: 'flex items-center gap-2',
  quiet: 'text-body-s text-secondary',
};

// Access management for one page. Link sharing and per-user invites are ADDITIVE —
// both can be active at once, layered over the workspace-member baseline. Applies
// to this page only (never its sub-pages).
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
  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        icon="ShareOutlined"
        title="Share"
        sub={`“${docTitle}” — access applies to this page only.`}
        onClose={onClose}
      />
      <div className="m-body">
        <LinkSection docId={docId} />
        <div className={styles.divider} />
        <InviteSection docId={docId} ownerId={ownerId} />
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

// "Anyone with the link" — off by default; creating a link exposes scope + role controls.
function LinkSection({ docId }: { docId: string }) {
  const { data: link, isLoading } = useShareLink(docId);
  const putLink = usePutShareLink(docId);
  const regenerate = useRegenerateShareLink(docId);
  const removeLink = useDeleteShareLink(docId);

  const setScope = (scope: ShareLinkScope) => link && putLink.mutate({ role: link.role, scope });
  const setRole = (role: WorkspaceRole) => link && putLink.mutate({ role, scope: link.scope });

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    pushToast({ kind: 'success', message: 'Link copied' });
  };

  return (
    <div className={styles.section} data-test-id="share-link-section">
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>
          <Icon name="ShareOutlined" size={14} muted />
          Anyone with the link
        </span>
        {isLoading ? (
          <Loader size={16} />
        ) : link ? (
          <Button
            variant="ghost"
            size="sm"
            icon="DeleteOutlined"
            disabled={removeLink.isPending}
            onClick={() => removeLink.mutate()}
          >
            Remove link
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon="AddOutlined"
            disabled={putLink.isPending}
            onClick={() => putLink.mutate({ role: 'READ', scope: 'REALM' })}
          >
            Create link
          </Button>
        )}
      </div>

      {!link && !isLoading && (
        <div className={styles.quiet}>Create a link to share this page beyond its workspace members.</div>
      )}

      {link && (
        <>
          <div className={styles.linkControls}>
            <div className={styles.selectWrap}>
              <Select
                options={SCOPE_OPTIONS}
                value={SCOPE_OPTIONS.find((o) => o.value === link.scope)}
                onChange={(o: { value: ShareLinkScope } | null) => o && setScope(o.value)}
                isSearchable={false}
                isClearable={false}
                size="small"
                testId="share-link-scope"
              />
            </div>
            <RoleSelect<WorkspaceRole>
              value={link.role}
              onChange={setRole}
              options={LINK_ROLE_OPTIONS}
              renderValue={(v) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Icon name={WS_ROLE_META[v].icon as IconName} size={14} muted />
                  {WS_ROLE_META[v].label}
                </span>
              )}
            />
          </div>

          {link.scope === 'ANYONE' && (
            <div className={styles.warn}>
              <Icon name="WarningTriangleOutlined" size={14} />
              Anyone on the internet with this link can access this page.
            </div>
          )}

          <div className={styles.linkUrlRow}>
            <span className={styles.linkUrl} data-test-id="share-link-url">
              {link.url}
            </span>
            <Button variant="primary" size="sm" onClick={copy}>
              Copy
            </Button>
          </div>

          <div className={styles.linkActions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(undefined, {
                  onSuccess: () => pushToast({ kind: 'success', message: 'New link generated' }),
                })
              }
            >
              Regenerate
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// "Invite" — realm-wide user search + per-page grants list.
function InviteSection({ docId, ownerId }: { docId: string; ownerId: string }) {
  const { data: grants = [] } = useDocPermissions(docId);
  const addPermission = useAddDocPermission();
  const updatePermission = useUpdateDocPermission();
  const removePermission = useRemoveDocPermission();

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

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>
        <Icon name="UserProfileOutlined" size={14} muted />
        Invite people
      </span>
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
            {adding ? '…' : 'Add'}
          </Button>
        </div>
        {addErrors.map((err) => (
          <div key={err.name} className={styles.errorText}>
            <Icon name="WarningTriangleOutlined" size={14} />
            {err.name}: {err.message}
          </div>
        ))}
      </div>

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
  );
}
