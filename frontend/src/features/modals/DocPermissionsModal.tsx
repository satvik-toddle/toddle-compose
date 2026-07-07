import { useMemo, useState, type ComponentType } from 'react';
import { SelectDropdown, ToggleSwitch } from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
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
import { WS_ROLE_META, WS_ROLES } from '../../lib/roles';
import type { WorkspaceRole } from '../../types/roles';
import type { ShareLinkScope } from '../../types/api';

// Owner shown atop the access list; email may be absent (DocumentDto.owner omits it).
interface DocOwner {
  id: string;
  name: string;
  email?: string;
  color?: string;
}

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

// Google-Docs-style labels for doc sharing (distinct from the workspace-role vocabulary).
const DOC_ROLE_LABEL: Record<WorkspaceRole, string> = {
  READ: 'Viewer',
  COMMENT: 'Commenter',
  EDIT: 'Editor',
  ADMIN: 'Full access',
};
const INVITE_ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: DOC_ROLE_LABEL[r] }));
const LINK_ROLE_OPTIONS = (['READ', 'COMMENT', 'EDIT'] as WorkspaceRole[]).map((r) => ({
  value: r,
  label: DOC_ROLE_LABEL[r],
}));
const SCOPE_OPTIONS: { value: ShareLinkScope; label: string }[] = [
  { value: 'REALM', label: 'Anyone in the org with the link' },
  { value: 'ANYONE', label: 'Anyone with the link (no sign-in)' },
];

const styles = {
  add: 'flex items-start gap-2',
  selectWrap: 'flex-1 min-w-0',
  errorText: 'mt-1 flex items-center gap-1.5 text-body-s text-semantic-error',
  lbl: 'mt-5 mb-1 text-body-xs font-semibold text-primary',
  people: 'flex flex-col max-h-[350px] overflow-auto',
  prow: 'flex items-center gap-3 py-2',
  who: 'flex-1 min-w-0',
  nm: 'flex items-center gap-1.5 text-body-s font-semibold text-primary truncate',
  sub: 'text-body-xs text-secondary truncate',
  ownerTag: 'pr-1.5 text-body-xs font-semibold text-secondary',
  removeBtn:
    'flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-1.5 border-0 bg-transparent hover:bg-surface-secondary-hover',
  // share-via-link block
  link: 'mt-4 pt-4 border-t border-secondary',
  linkHead: 'flex items-center gap-3',
  linkIc: 'flex h-9.5 w-9.5 flex-none items-center justify-center rounded-full bg-surface-tertiary-enabled',
  linkTxt: 'flex-1 min-w-0',
  linkT: 'text-body-s font-semibold text-primary',
  linkD: 'mt-0.5 text-body-xs text-secondary',
  linkRow: 'mt-3.5 flex items-center gap-2',
  linkField:
    'flex-1 flex items-center gap-2 h-10 px-3 rounded-1.5 border border-secondary bg-surface-secondary-enabled text-body-s text-primary min-w-0',
  url: 'flex-1 truncate',
  permRow: 'mt-3 flex items-center gap-2 flex-wrap text-body-xs text-secondary',
  actions: 'mt-2',
  warn: 'mt-2 flex items-center gap-1.5 text-body-xs text-semantic-warning',
  footNote: 'flex items-center gap-1.5 text-body-xs text-secondary',
};

// Doc share modal (design 4e): add people + list who has access, then a "Share via
// link" toggle. Link and invites are additive, layered over workspace-member access.
export function DocPermissionsModal({
  onClose,
  docId,
  docTitle,
  owner,
}: {
  onClose: () => void;
  docId: string;
  docTitle: string;
  owner: DocOwner;
}) {
  const { data: link } = useShareLink(docId);
  const linkOn = !!link;

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        icon="ShareOutlined"
        title={`Share “${docTitle}”`}
        sub="Only people you add can open it — access applies to this page only."
        onClose={onClose}
      />
      <div className="m-body">
        <InviteSection docId={docId} owner={owner} />
        <LinkSection docId={docId} />
      </div>
      <div className="m-foot">
        <span className={styles.footNote}>
          <Icon name={linkOn ? 'GlobeOutlined' : 'LockOutlined'} size={14} muted />
          {linkOn ? 'Link sharing on' : 'Restricted'}
        </span>
        <span className="gap" />
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

const renderRole = (v: WorkspaceRole) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
    <Icon name={WS_ROLE_META[v].icon as IconName} size={14} muted />
    {DOC_ROLE_LABEL[v]}
  </span>
);

// Add-people row + the "People with access" list (owner first, then grantees).
function InviteSection({ docId, owner }: { docId: string; owner: DocOwner }) {
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

  // Realm-wide matches except the owner (always full access) and existing grantees.
  const options = useMemo(() => {
    const granted = new Set(grants.map((g) => g.userId));
    return users
      .filter((u) => u.id !== owner.id && !granted.has(u.id))
      .map(
        (u): MemberOption => ({
          value: u.id,
          label: u.name,
          subtitle: u.email,
          icon: <Avatar person={{ name: u.name, color: u.color }} size={20} />,
          email: u.email,
        }),
      );
  }, [users, grants, owner.id]);

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
    setSelected(failed);
    setAddErrors(errors);
    if (errors.length === 0) {
      const n = selected.length;
      pushToast({ kind: 'success', message: `Access granted to ${n} ${n === 1 ? 'person' : 'people'}` });
    }
  };

  return (
    <>
      <div className={styles.add}>
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
            filterOption={null}
            placeholder="Add people by name or email"
            noOptionsText={term.trim() ? 'No matching people in this org' : 'No people to suggest'}
            loader={isSearching ? <Loader size={18} label="Searching" /> : undefined}
            size="small"
            testId="doc-perm-users"
            error={addErrors.length > 0 ? ' ' : undefined}
          />
        </div>
        <RoleSelect<WorkspaceRole>
          value={role}
          onChange={setRole}
          options={INVITE_ROLE_OPTIONS}
          renderValue={renderRole}
        />
        <IconButton
          icon="SendOutlined"
          variant="primary"
          type="fill"
          aria-label="Add people"
          disabled={selected.length === 0 || adding}
          onClick={add}
        />
      </div>
      {addErrors.map((err) => (
        <div key={err.name} className={styles.errorText}>
          <Icon name="WarningTriangleOutlined" size={14} />
          {err.name}: {err.message}
        </div>
      ))}

      <div className={styles.lbl}>People with access</div>
      <div className={styles.people}>
        <div className={styles.prow}>
          <Avatar person={{ name: owner.name, color: owner.color }} size={34} />
          <div className={styles.who}>
            <div className={styles.nm}>{owner.name}</div>
            {owner.email && <div className={styles.sub}>{owner.email}</div>}
          </div>
          <span className={styles.ownerTag}>Owner</span>
        </div>
        {grants.map((g) => (
          <div key={g.userId} className={styles.prow}>
            <Avatar person={{ name: g.user.name, color: g.user.color }} size={34} />
            <div className={styles.who}>
              <div className={styles.nm}>{g.user.name}</div>
              <div className={styles.sub}>{g.user.email}</div>
            </div>
            <RoleSelect<WorkspaceRole>
              value={g.role}
              onChange={(r) => updatePermission.mutate({ docId, userId: g.userId, role: r })}
              options={INVITE_ROLE_OPTIONS}
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
    </>
  );
}

// "Share via link" — a toggle that reveals the link URL, scope, and link-role picker.
function LinkSection({ docId }: { docId: string }) {
  const { data: link, isLoading } = useShareLink(docId);
  const putLink = usePutShareLink(docId);
  const regenerate = useRegenerateShareLink(docId);
  const removeLink = useDeleteShareLink(docId);
  const linkOn = !!link;

  const toggle = () => {
    if (linkOn) removeLink.mutate();
    else putLink.mutate({ role: 'READ', scope: 'REALM' });
  };
  const setScope = (scope: ShareLinkScope) => link && putLink.mutate({ role: link.role, scope });
  const setRole = (role: WorkspaceRole) => link && putLink.mutate({ role, scope: link.scope });
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    pushToast({ kind: 'success', message: 'Link copied' });
  };
  const busy = putLink.isPending || removeLink.isPending || isLoading;

  return (
    <div className={styles.link} data-test-id="share-link-section">
      <div className={styles.linkHead}>
        <span className={styles.linkIc}>
          <Icon name={linkOn ? 'GlobeOutlined' : 'LockOutlined'} size={18} muted />
        </span>
        <div className={styles.linkTxt}>
          <div className={styles.linkT}>Share via link</div>
          <div className={styles.linkD}>
            {linkOn
              ? 'Anyone with the link can open this doc — no workspace membership needed.'
              : 'Off — only the people listed above can open this doc.'}
          </div>
        </div>
        <ToggleSwitch
          dsVersion="2.0"
          checked={linkOn}
          onChange={toggle}
          disabled={busy}
          aria-label="Share via link"
          testId="share-link-toggle"
        />
      </div>

      {link && (
        <>
          <div className={styles.linkRow}>
            <span className={styles.linkField}>
              <Icon name="GlobeOutlined" size={14} muted />
              <span className={styles.url} data-test-id="share-link-url">
                {link.url}
              </span>
            </span>
            <Button variant="primary" size="sm" icon="ShareOutlined" onClick={copy}>
              Copy link
            </Button>
          </div>

          <div className={styles.permRow}>
            <span>Anyone with the link can</span>
            <RoleSelect<WorkspaceRole>
              value={link.role}
              onChange={setRole}
              options={LINK_ROLE_OPTIONS}
              renderValue={renderRole}
            />
            <div style={{ minWidth: 220 }}>
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
          </div>

          {link.scope === 'ANYONE' && (
            <div className={styles.warn}>
              <Icon name="WarningTriangleOutlined" size={14} />
              Anyone on the internet with this link can access this page.
            </div>
          )}

          <div className={styles.actions}>
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
              Regenerate link
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
