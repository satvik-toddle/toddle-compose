import { useMemo, useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar as DsAvatar,
  Button as DsButton,
  IconButton as DsIconButton,
  SelectDropdown,
  TextInput,
  ToggleSwitch,
} from '@toddle-edu/ds-web';
import { Modal, ModalHead } from '../../components/Modal';
import { Icon, type IconName } from '../../components/Icon';
import { dsAvatarColor } from '../../lib/dsAvatar';
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
  useRefreshDocAccess,
} from '../../hooks/useShareLink';
import { useGrantableUserSearch } from '../../hooks/useGrantableUserSearch';
import { UserPicker, type UserOption } from '../../components/UserPicker';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { WS_ROLE_META, WS_ROLES } from '../../lib/roles';
import { qk } from '../../lib/queryKeys';
import type { WorkspaceRole } from '../../types/roles';
import type { ShareLinkScope } from '../../types/api';

// Owner shown atop the access list; email may be absent (DocumentDto.owner omits it).
interface DocOwner {
  id: string;
  name: string;
  email?: string;
  color?: string;
}

// The version-switching selector's union type drops react-select props (isMulti/value/onChange); used untyped for the link-scope picker below (people picker lives in UserPicker).
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// Google-Docs-style labels for doc sharing (distinct from the workspace-role vocabulary).
const DOC_ROLE_LABEL: Record<WorkspaceRole, string> = {
  READ: 'Viewer',
  COMMENT: 'Commenter',
  EDIT: 'Editor',
  ADMIN: 'Full access',
};
const INVITE_ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: DOC_ROLE_LABEL[r] }));
// Verbs, not persona nouns — reads as a sentence after "Anyone with the link can".
const LINK_ROLE_LABEL: Partial<Record<WorkspaceRole, string>> = {
  READ: 'View',
  COMMENT: 'Comment',
  EDIT: 'Edit',
};
const LINK_ROLE_OPTIONS = (['READ', 'COMMENT', 'EDIT'] as WorkspaceRole[]).map((r) => ({
  value: r,
  label: LINK_ROLE_LABEL[r]!,
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
  // share-via-link block
  link: 'mt-4 pt-4 border-t border-secondary',
  linkHead: 'flex items-center gap-3',
  linkIc: 'flex h-9.5 w-9.5 flex-none items-center justify-center rounded-full bg-surface-tertiary-enabled',
  linkTxt: 'flex-1 min-w-0',
  linkT: 'text-body-s font-semibold text-primary',
  linkD: 'mt-0.5 text-body-xs text-secondary',
  linkRow: 'mt-3 flex items-center gap-2',
  permRow: 'mt-3.5 flex items-center gap-2 flex-wrap',
  warn: 'mt-2 flex items-center gap-1.5 text-body-xs text-semantic-warning',
  alertWrap: 'mt-3',
  footNote: 'flex items-center gap-1.5 text-body-xs text-secondary',
};

// Doc share modal (design 4e): add people + list who has access, plus a "Share via link" toggle layered over workspace-member access.
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
  const refreshAccess = useRefreshDocAccess(docId);
  // Lifted so both people-grant changes and link changes can request the "takes up to 5 minutes / Apply now" kick.
  const [accessDirty, setAccessDirty] = useState(false);
  const markDirty = () => setAccessDirty(true);

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        icon="ShareOutlined"
        title={`Share “${docTitle}”`}
        sub="Give specific people access to this page, on top of workspace members. Grants apply to this page only."
        onClose={onClose}
      />
      <div className="m-body">
        <InviteSection docId={docId} owner={owner} onAccessChange={markDirty} />
        <LinkSection docId={docId} onAccessChange={markDirty} />
        {accessDirty && (
          <div className={styles.alertWrap}>
            <Alert
              dsVersion="2.0"
              type="warning"
              message="Access changes can take up to 5 minutes to reach people already in the doc."
              actionElementPosition="bottom"
              testId="share-link-propagation-alert"
              actionElement={
                <DsButton
                  dsVersion="2.0"
                  variant="primary"
                  type="fill"
                  disabled={refreshAccess.isPending}
                  testId="share-link-apply-now"
                  onClick={() =>
                    refreshAccess.mutate(undefined, {
                      onSuccess: () => {
                        setAccessDirty(false);
                        pushToast({ kind: 'success', message: 'Access re-checked for everyone in this doc' });
                      },
                      onError: (e) =>
                        pushToast({ kind: 'error', message: `Couldn't apply changes: ${messageOf(e)}` }),
                    })
                  }
                >
                  Apply now
                </DsButton>
              }
            />
          </div>
        )}
      </div>
      <div className="m-foot">
        <span className={styles.footNote}>
          <Icon name={linkOn ? 'GlobeOutlined' : 'LockOutlined'} size={14} muted />
          {linkOn ? 'Link sharing on' : 'Restricted'}
        </span>
        <span className="gap" />
        <DsButton dsVersion="2.0" variant="primary" type="fill" onClick={onClose}>
          Done
        </DsButton>
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

const renderLinkRole = (v: WorkspaceRole) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
    <Icon name={WS_ROLE_META[v].icon as IconName} size={14} muted />
    {LINK_ROLE_LABEL[v]}
  </span>
);

// Add-people row + the "People with access" list (owner first, then grantees).
function InviteSection({
  docId,
  owner,
  onAccessChange,
}: {
  docId: string;
  owner: DocOwner;
  onAccessChange: () => void;
}) {
  const qc = useQueryClient();
  const { data: grants = [] } = useDocPermissions(docId);
  const addPermission = useAddDocPermission();
  const updatePermission = useUpdateDocPermission();
  const removePermission = useRemoveDocPermission();

  const [term, setTerm] = useState('');
  const { users, isSearching, error: searchError } = useGrantableUserSearch(docId, term);
  const [selected, setSelected] = useState<UserOption[]>([]);
  const [role, setRole] = useState<WorkspaceRole>('EDIT');
  const [adding, setAdding] = useState(false);
  const [addErrors, setAddErrors] = useState<{ name: string; message: string }[]>([]);

  // Exclude the owner (always full access) and existing grantees from the suggestions.
  const excludeIds = useMemo(
    () => new Set([owner.id, ...grants.map((g) => g.userId)]),
    [owner.id, grants],
  );

  const add = async () => {
    if (selected.length === 0 || adding) return;
    setAdding(true);
    setAddErrors([]);
    const failed: UserOption[] = [];
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
    // Refetch the access list once for the whole batch, so it reshuffles a single time.
    if (failed.length < selected.length)
      qc.invalidateQueries({ queryKey: qk.docPermissions(docId) });
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
          <UserPicker
            isMulti
            users={users}
            isSearching={isSearching}
            searchError={searchError}
            term={term}
            onTermChange={setTerm}
            excludeIds={excludeIds}
            renderAvatar={(u) => (
              <DsAvatar
                dsVersion="2.0"
                name={u.name}
                color={dsAvatarColor(u.color)}
                size="xxx-small"
                shape="circle"
              />
            )}
            value={selected}
            onChange={(opts) => {
              setSelected(opts);
              setAddErrors([]);
            }}
            placeholder="Add people by name or email"
            noMatchText="No matching people in this org"
            testId="doc-perm-users"
            showError={addErrors.length > 0}
          />
        </div>
        <RoleSelect<WorkspaceRole>
          value={role}
          onChange={setRole}
          options={INVITE_ROLE_OPTIONS}
          renderValue={renderRole}
          size="medium"
        />
        <DsIconButton
          dsVersion="2.0"
          variant="primary"
          type="fill"
          icon={<Icon name="SendOutlined" size={14} />}
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

      <div className={styles.lbl}>People you’ve added</div>
      <div className={styles.people}>
        {grants.length === 0 && (
          <div className={styles.sub}>No one has been added yet.</div>
        )}
        {grants.map((g) => (
          <div key={g.userId} className={styles.prow}>
            <DsAvatar
              dsVersion="2.0"
              name={g.user.name}
              color={dsAvatarColor(g.user.color)}
              size="medium"
              shape="circle"
            />
            <div className={styles.who}>
              <div className={styles.nm}>{g.user.name}</div>
              <div className={styles.sub}>{g.user.email}</div>
            </div>
            <RoleSelect<WorkspaceRole>
              value={g.role}
              onChange={(r) =>
                updatePermission.mutate(
                  { docId, userId: g.userId, role: r },
                  { onSuccess: onAccessChange },
                )
              }
              options={INVITE_ROLE_OPTIONS}
              renderValue={renderRole}
              size="medium"
            />
            <DsIconButton
              dsVersion="2.0"
              variant="neutral"
              type="plain"
              icon={<Icon name="CloseOutlined" size={14} muted />}
              aria-label="Remove access"
              disabled={removePermission.isPending}
              onClick={() =>
                removePermission.mutate({ docId, userId: g.userId }, { onSuccess: onAccessChange })
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}

// "Share via link" — a toggle that reveals the link URL, scope, and link-role picker.
function LinkSection({ docId, onAccessChange }: { docId: string; onAccessChange: () => void }) {
  const { data: link, isLoading } = useShareLink(docId);
  const putLink = usePutShareLink(docId);
  const regenerate = useRegenerateShareLink(docId);
  const removeLink = useDeleteShareLink(docId);
  const linkOn = !!link;
  // Any link-access change requests the modal-level "takes up to 5 minutes / Apply now" alert.
  const markDirty = { onSuccess: onAccessChange };

  const toggle = () => {
    // Enabling only grants new access — no one is connected via the link yet, so no alert.
    if (linkOn) removeLink.mutate(undefined, markDirty);
    else putLink.mutate({ role: 'READ', scope: 'REALM' });
  };
  const setScope = (scope: ShareLinkScope) =>
    link && putLink.mutate({ role: link.role, scope }, markDirty);
  const setRole = (role: WorkspaceRole) =>
    link && putLink.mutate({ role, scope: link.scope }, markDirty);
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
          <div className={styles.permRow}>
            <RoleSelect<WorkspaceRole>
              value={link.role}
              onChange={setRole}
              options={LINK_ROLE_OPTIONS}
              renderValue={renderLinkRole}
              size="medium"
            />
            <div style={{ minWidth: 220 }}>
              <Select
                dsVersion="2.0"
                options={SCOPE_OPTIONS}
                value={SCOPE_OPTIONS.find((o) => o.value === link.scope)}
                onChange={(o: { value: ShareLinkScope } | null) => o && setScope(o.value)}
                isSearchable={false}
                isClearable={false}
                testId="share-link-scope"
              />
            </div>
            <DsButton
              dsVersion="2.0"
              variant="neutral"
              type="outlined"
              icon={<Icon name="ReloadArrowOutlined" size={14} />}
              testId="share-link-regenerate"
              disabled={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(undefined, {
                  onSuccess: () => {
                    onAccessChange();
                    pushToast({ kind: 'success', message: 'New link generated' });
                  },
                })
              }
            >
              Regenerate
            </DsButton>
          </div>

          <div className={styles.linkRow}>
            <div className={styles.selectWrap}>
              {/* readOnly (not disabled) so the URL stays focusable and selectable for manual copying. */}
              <TextInput
                dsVersion="2.0"
                leadingIcon={<Icon name="GlobeOutlined" size={14} muted />}
                value={link.url}
                readOnly
                aria-label="Share link URL"
                testId="share-link-url"
              />
            </div>
            <DsIconButton
              dsVersion="2.0"
              variant="primary"
              type="fill"
              icon={<Icon name="CopyOutlined" size={14} />}
              aria-label="Copy link"
              testId="share-link-copy"
              onClick={copy}
            />
          </div>

          {link.scope === 'ANYONE' && (
            <div className={styles.warn}>
              <Icon name="WarningTriangleOutlined" size={14} />
              Anyone on the internet with this link can access this page.
            </div>
          )}

        </>
      )}
    </div>
  );
}
