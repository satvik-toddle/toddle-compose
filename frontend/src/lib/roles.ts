import {
  type RealmRole,
  type WorkspaceRole,
  REALM_ORDER,
  WS_ORDER,
} from '../types/roles';

export function realmAtLeast(role: RealmRole | null | undefined, min: RealmRole): boolean {
  return role != null && REALM_ORDER[role] >= REALM_ORDER[min];
}
export function wsAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  return role != null && WS_ORDER[role] >= WS_ORDER[min];
}
export function isRealmAdmin(role: RealmRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'MAINTAINER';
}
export function isUserMember(role: RealmRole | null | undefined): boolean {
  return role === 'MEMBER';
}
export function maxWsRole(
  a: WorkspaceRole | null,
  b: WorkspaceRole | null,
): WorkspaceRole | null {
  if (a == null) return b;
  if (b == null) return a;
  return WS_ORDER[a] >= WS_ORDER[b] ? a : b;
}

// Effective workspace role including the realm overlay (OWNER/MAINTAINER act as
// ADMIN in every workspace). `overlay` drives the dashed "Admin · via realm" chip.
export function effectiveWorkspaceRole(
  realmRole: RealmRole | null | undefined,
  wsRole: WorkspaceRole | null | undefined,
): { role: WorkspaceRole | null; overlay: boolean } {
  if (isRealmAdmin(realmRole)) return { role: 'ADMIN', overlay: true };
  return { role: wsRole ?? null, overlay: false };
}

// ---- Chip display metadata (icon names map to components/iconMap.ts) ----
export const REALM_ROLE_META: Record<RealmRole, { label: string; icon: string }> = {
  OWNER: { label: 'Owner', icon: 'StarOutlined' },
  MAINTAINER: { label: 'Maintainer', icon: 'BoltOutlined' },
  MEMBER: { label: 'Member', icon: 'UserProfileOutlined' },
};

export const WS_ROLE_META: Record<
  WorkspaceRole,
  { label: string; icon: string; desc: string }
> = {
  READ: { label: 'Read', icon: 'EyeOutlined', desc: 'View pages only' },
  COMMENT: { label: 'Comment', icon: 'CommentOutlined', desc: 'View and comment' },
  EDIT: { label: 'Edit', icon: 'PencilOutlined', desc: 'Create and edit pages' },
  ADMIN: { label: 'Admin', icon: 'SettingsOutlined', desc: 'Manage members & settings' },
};

export const REALM_ROLES: RealmRole[] = ['OWNER', 'MAINTAINER', 'MEMBER'];
export const WS_ROLES: WorkspaceRole[] = ['READ', 'COMMENT', 'EDIT', 'ADMIN'];
