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
  guest?: boolean; // true when the caller has no workspace membership and entered via a per-page grant
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
  guest?: boolean; // true when the caller has no membership and sees the workspace shell via a per-page grant
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
  realmRole?: RealmRole | null; // the member's realm role, so the UI can gate admin-only controls
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

export type ShareLinkScope = 'REALM' | 'ANYONE';

// A document's public/realm share link (manage endpoints; managers only).
export interface DocumentShareLink {
  token: string;
  role: WorkspaceRole; // READ | COMMENT | EDIT
  scope: ShareLinkScope;
  createdAt: string;
  url: string; // ready-to-copy frontend URL (/link/:token)
}

// GET /share-links/:token — public resolve of a link to its document.
export interface ShareLinkResolve {
  document: { id: string; title: string; icon: string; type: DocumentType; workspaceId: string };
  role: WorkspaceRole;
  scope: ShareLinkScope;
}

export interface DocumentDto {
  id: string;
  type: DocumentType;
  title: string;
  icon: string;
  workspaceId: string;
  folderId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; color: string };
  isStarred?: boolean; // whether the current user has starred this page (always true in the starred list)
  myRole?: WorkspaceRole | null; // caller's effective role on this doc = owner ? ADMIN : max(ws role, per-doc grant); null for public-only viewers
  sharedAt?: string; // when the caller's per-page grant was created (only on the shared-with-me list)
  workspace?: { id: string; name: string }; // present on the global shared-with-me list (docs span workspaces)
}

// GET /documents/:id — a single doc plus its ancestor breadcrumb trail (the list summary
// omits breadcrumbs; this is the authoritative trail for a doc not in the paginated list).
export interface DocumentDetailDto extends DocumentDto {
  breadcrumbs: Array<{ id: string; title: string; icon: string | null }>;
}

// GET /documents/search — why a result matched.
export type SearchMatch = 'title' | 'content';

// A search hit: a document plus its match reason (workspace{id,name} on DocumentDto is populated for global rows).
export interface SearchResultDto extends DocumentDto {
  match: SearchMatch;
  snippet?: string; // content-match excerpt; absent for title-only matches
}

// One keyset page of search results plus the total for the "loaded / total" UI.
export interface DocSearchPage {
  items: SearchResultDto[];
  total: number; // distinct matches (title ∪ content), up to the server cap
  nextCursor: string | null; // opaque keyset cursor; null when there are no more pages
}

// Read-only projection of a SHEET's grid for the preview pane.
export interface SheetPreviewDto {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
}

// GET /documents/:id/preview — head-of-log content for the split-modal preview.
export interface DocPreviewDto {
  docId: string;
  type: DocumentType;
  title: string;
  icon: string;
  breadcrumbs: Array<{ id: string; title: string; icon: string | null }>;
  updatedAt: string;
  headSeq: number;
  lexicalJson?: string | null; // DOC body as stored Lexical editorState JSON
  plainText?: string; // DOC plain-text projection
  sheet?: SheetPreviewDto | null; // present only for SHEET docs
}

// GET /documents/:id/permissions row — EDIT/ADMIN granted on one document, independent of workspace membership.
export interface DocumentPermission {
  userId: string;
  documentId: string;
  role: WorkspaceRole;
  createdAt: string;
  user: PublicUser;
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
  // DOC docs: server-extracted Lexical editorState at this seq (upload URLs materialized). SHEET docs omit it.
  lexicalJson?: string;
  // DOC docs, when ?diff=<baselineSeq> was requested: merged diff editorState (baseline -> seq) with diff-mark nodes.
  diffJson?: string | null;
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
