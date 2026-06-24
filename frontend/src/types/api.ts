import type { RealmRole, WorkspaceRole, Visibility, JoinRequestState } from './roles';

// The authenticated identity. `activeWorkspaceId` mirrors the access-token claim.
export interface User {
  id: string;
  email: string;
  name: string;
  color: string; // brand hex, used for the avatar background
  activeWorkspaceId: string | null;
}

// Slim user shape nested inside member / request rows.
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  color: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface AuthResponse extends AuthTokens {
  user: User;
}

// POST /auth/workspace/enter — re-mints the access token scoped to a workspace.
export interface EnterWorkspaceResponse {
  accessToken: string;
  expiresIn: number;
  workspaceId: string;
  role: WorkspaceRole;
}

// POST /auth/workspace/leave — re-mints an unscoped access token.
export interface LeaveWorkspaceResponse {
  accessToken: string;
  expiresIn: number;
  workspaceId: null;
}

export interface RealmInfo {
  id: string;
  name: string;
  role: RealmRole; // caller's realm role
  allowedEmailDomains: string[]; // self-signup allowlist; empty = any domain
}

export interface RealmMember {
  realmId: string;
  userId: string;
  role: RealmRole;
  createdAt: string;
  user: PublicUser;
}

export interface Workspace {
  id: string;
  realmId: string;
  name: string;
  visibility: Visibility;
  defaultRole: WorkspaceRole;
  createdAt: string;
  role: WorkspaceRole; // caller's effective role in this workspace
}

// GET /workspaces/discoverable — metadata only, no role.
export interface DiscoverableWorkspace {
  id: string;
  name: string;
  visibility: Visibility;
  defaultRole: WorkspaceRole;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
  user: PublicUser;
}

export interface JoinRequest {
  id: string;
  workspaceId: string;
  userId: string;
  state: JoinRequestState;
  requestedRole: WorkspaceRole;
  decidedById: string | null;
  createdAt: string;
  decidedAt: string | null;
  user: PublicUser;
  // Present on the realm-wide listing (so a row can name its workspace).
  workspace?: { id: string; name: string; visibility: Visibility };
}

export interface DocumentDto {
  id: string;
  title: string;
  icon: string;
  visibility: Visibility;
  workspaceId: string;
  folderId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; color: string };
}

export interface FolderDto {
  id: string;
  name: string;
  icon: string;
  isPersonal: boolean;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OkResponse {
  ok: true;
}
