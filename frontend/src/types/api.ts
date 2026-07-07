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

// POST /auth/register and /auth/resend-verification — no session is issued until
// the emailed link is verified.
export interface VerificationPending {
  status: 'verification_sent';
  email: string;
  emailDelivered: boolean; // false when the backend mailer is in dev/console mode (link logged, not sent)
  verified: boolean; // true when the account is already verified (email service bypassed, no link to wait for)
}

// GET /auth/config — public client config flagging email-dependent flows.
export interface AuthConfig {
  passwordResetEnabled: boolean; // false when the backend email service is bypassed (no self-serve password reset)
}

// POST /auth/verify-email — success.
export interface VerifyEmailResponse {
  status: 'verified';
  email: string;
}

// POST /auth/forgot-password — always generic (no account-existence leak).
export interface ResetEmailSent {
  status: 'reset_email_sent';
}

// POST /auth/reset-password — success.
export interface ResetPasswordResponse {
  status: 'reset';
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
  allowedEmailDomains?: string[]; // self-signup allowlist; empty = any domain, only returned to OWNER/MAINTAINER
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
  workspace?: { id: string; name: string; visibility: Visibility }; // present on the realm-wide listing (so a row can name its workspace)
}

export type DocumentType = 'DOC' | 'SHEET';

export interface DocumentDto {
  id: string;
  type: DocumentType;
  title: string;
  icon: string;
  visibility: Visibility;
  workspaceId: string;
  folderId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; color: string };
  isStarred?: boolean; // whether the current user has starred this page (always true in the starred list)
}

// One edit "session": updates by a single author grouped by a time gap. `startedAt`
// / `endedAt` are epoch-ms; `lastSeq` is the update seq to preview the doc's state at.
export interface DocHistorySession {
  firstSeq: number;
  lastSeq: number;
  startedAt: number;
  endedAt: number;
  updateCount: number;
  totalBytes: number;
  noop: boolean;
  // 'archive' = a tier-2 archive snapshot (label "Archived"); 'edit' = a real edit session.
  kind: 'archive' | 'edit';
  changedCells: Array<{ rowId: string; colId: string }>;
  user: { id: string; name: string; email: string; color: string } | null;
}

// GET /documents/:id/history — edit-session timeline, newest first.
export interface DocHistoryResponse {
  docId: string;
  head: number;
  sessions: DocHistorySession[];
}

// GET /documents/:id/history/:seq — read-only snapshot of the doc at an update seq.
export interface DocSnapshot {
  docId: string;
  type: DocumentType;
  seq: number;
  headSeq: number;
  // DOC docs: full Yjs state at this seq (base64) for read-only rendering. SHEET docs omit it.
  yjsStateB64?: string;
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
