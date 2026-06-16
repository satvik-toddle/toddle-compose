import { useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { TextInput } from '../../components/TextInput';
import { RoleSelect } from '../../components/RoleSelect';
import { useDocuments, useSetDocumentVisibility } from '../../hooks/usePages';
import { useWorkspaceMembers, useRealm } from '../../hooks/queries';
import { useAddWorkspaceMember, useRemoveWorkspaceMember } from '../../hooks/useWorkspaceMemberMutations';
import { isNotFound, messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { cn } from '../../lib/cn';
import type { WorkspaceRole } from '../../types/roles';

// Share dialog for a document. Surfaces who can access it, lets a manager flip
// PUBLIC/PRIVATE, copies a deep link, and (for workspace admins) invites people
// by email. NOTE: this app's backend has no per-page access — adding someone
// grants them access to the whole WORKSPACE (all its pages), via the existing
// add-member endpoint. True per-page sharing is a future backend ticket.
export function ShareDocumentModal({
  onClose,
  workspaceId,
  docId,
  docTitle,
  canManage,
  isAdmin,
}: {
  onClose: () => void;
  workspaceId: string;
  docId: string;
  docTitle: string;
  canManage: boolean;
  isAdmin: boolean;
}) {
  const me = useAuthStore((s) => s.user);
  // Read the live doc from cache so visibility stays in sync after a toggle.
  const { data: docs = [] } = useDocuments(workspaceId);
  const doc = docs.find((d) => d.id === docId);
  const { data: members = [] } = useWorkspaceMembers(workspaceId, true);
  const { data: realm } = useRealm();
  const setVisibility = useSetDocumentVisibility();
  const addMember = useAddWorkspaceMember();
  const removeMember = useRemoveWorkspaceMember();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('EDIT');
  const notFound = isNotFound(addMember.error);

  const isPublic = (doc?.visibility ?? 'PRIVATE') === 'PUBLIC';
  const realmName = realm?.name ?? 'the realm';
  const ownerId = doc?.owner.id;

  const setVis = (visibility: 'PRIVATE' | 'PUBLIC') => {
    if (!canManage || setVisibility.isPending) return;
    if ((visibility === 'PUBLIC') === isPublic) return; // no-op if unchanged
    setVisibility.mutate({ workspaceId, id: docId, visibility });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/w/${workspaceId}?doc=${docId}`);
      pushToast({ kind: 'success', message: 'Link copied' });
    } catch {
      pushToast({ kind: 'error', message: 'Could not copy the link' });
    }
  };

  const invite = () => {
    if (!email.trim() || addMember.isPending) return;
    addMember.mutate(
      { workspaceId, email: email.trim(), role },
      {
        onSuccess: () => {
          setEmail('');
          pushToast({ kind: 'success', message: 'Added to the workspace' });
        },
      },
    );
  };

  const otherMembers = members.filter((m) => m.userId !== ownerId);

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        icon="ShareOutlined"
        title={`Share “${docTitle}”`}
        sub="Control who can open this page."
        onClose={onClose}
      />
      <div className="m-body">
        {/* General access — visibility */}
        <div className="share-vis">
          <button
            type="button"
            className={cn('share-opt', !isPublic && 'on')}
            disabled={!canManage}
            onClick={() => setVis('PRIVATE')}
          >
            <Icon name="LockOutlined" size={18} muted />
            <div>
              <div className="t">Private</div>
              <div className="d">Only people with access to this workspace</div>
            </div>
            {!isPublic && <Icon name="TickSmallOutlined" size={16} />}
          </button>
          <button
            type="button"
            className={cn('share-opt', isPublic && 'on')}
            disabled={!canManage}
            onClick={() => setVis('PUBLIC')}
          >
            <Icon name="GlobeOutlined" size={18} muted />
            <div>
              <div className="t">Public in {realmName}</div>
              <div className="d">Anyone in the realm can view</div>
            </div>
            {isPublic && <Icon name="TickSmallOutlined" size={16} />}
          </button>
        </div>
        {!canManage && (
          <div className="share-note">
            <Icon name="InformationOutlined" size={14} muted />
            Only the owner or a workspace admin can change this.
          </div>
        )}

        {/* Invite by email — workspace admins only */}
        {isAdmin && (
          <div className="share-invite">
            <div className="share-invite-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  icon="EmailOutlined"
                  type="email"
                  value={email}
                  placeholder="Add people by email…"
                  err={addMember.isError}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') invite();
                  }}
                />
              </div>
              <RoleSelect<WorkspaceRole>
                value={role}
                onChange={setRole}
                options={WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }))}
                renderValue={(v) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <Icon name={WS_ROLE_META[v].icon as IconName} size={14} muted />
                    {WS_ROLE_META[v].label}
                  </span>
                )}
              />
              <Button
                variant="primary"
                icon="AddOutlined"
                disabled={!email.trim() || addMember.isPending}
                onClick={invite}
              >
                {addMember.isPending ? '…' : 'Add'}
              </Button>
            </div>
            <div className="share-note">
              <Icon name="InformationOutlined" size={14} muted />
              Adds them to the workspace — they’ll get access to all its pages.
            </div>
            {notFound && (
              <div className="err-text">
                <Icon name="WarningTriangleOutlined" size={14} />
                No user with that email — they must register first.
              </div>
            )}
            {addMember.isError && !notFound && (
              <div className="err-text">
                <Icon name="WarningTriangleOutlined" size={14} />
                {messageOf(addMember.error)}
              </div>
            )}
          </div>
        )}

        {/* People with access */}
        <div className="share-people">
          <div className="share-people-h">People with access</div>
          {doc && (
            <div className="share-row">
              <Avatar person={{ name: doc.owner.name, color: doc.owner.color }} size={28} />
              <div className="who">
                <div className="nm">{doc.owner.name}</div>
              </div>
              <span className="share-tag">Owner</span>
            </div>
          )}
          {otherMembers.map((m) => (
            <div key={m.userId} className="share-row">
              <Avatar person={{ name: m.user.name, color: m.user.color }} size={28} />
              <div className="who">
                <div className="nm">{m.user.name}</div>
                <div className="sub">{m.user.email}</div>
              </div>
              <WSChip role={m.role} sm />
              {isAdmin && m.userId !== me?.id && (
                <button
                  className="share-x"
                  title="Remove from workspace"
                  disabled={removeMember.isPending}
                  onClick={() => removeMember.mutate({ workspaceId, userId: m.userId })}
                >
                  <Icon name="CloseOutlined" size={14} muted />
                </button>
              )}
            </div>
          ))}
          {isPublic && (
            <div className="share-row">
              <span className="share-globe">
                <Icon name="GlobeOutlined" size={16} muted />
              </span>
              <div className="who">
                <div className="nm">Anyone in {realmName}</div>
                <div className="sub">Can view this page</div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="m-foot">
        <Button variant="ghost" icon="ShareOutlined" onClick={copyLink}>
          Copy link
        </Button>
        <span className="gap" />
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
