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

// ---- Copy to Coda / migrations ---------------------------------------------

// One Coda token attached to a destination — masked; plaintext never leaves the server.
export interface MigrationScopeToken {
  id: string;
  hint: string | null; // last-4 of the token
  label: string | null;
  createdAt: string;
}

// A migration destination (per-workspace): a scope root inside Coda + its token pool.
export interface MigrationScope {
  id: string;
  workspaceId: string;
  label: string;
  codaDocId: string;
  codaRootPageId: string | null; // null = whole-doc root (migrate as top-level pages)
  codaRootUrl: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  tokens: MigrationScopeToken[];
}

// One token to attach when creating/updating a scope (plaintext on the wire only).
export interface MigrationScopeTokenInput {
  token: string;
  label?: string;
}

// POST /migration-scopes body.
export interface CreateMigrationScopeInput {
  workspaceId: string;
  label: string;
  codaUrl: string;
  tokens: MigrationScopeTokenInput[];
}

// PATCH /migration-scopes/:id body — rename and/or add/remove pool tokens.
export interface UpdateMigrationScopeInput {
  label?: string;
  addTokens?: MigrationScopeTokenInput[];
  removeTokenIds?: string[];
}

// GET /migration-scopes/:scopeId/mappings row — a saved (sourceDocId, scope) mapping
// the modal prefills each row's destination from for the selected scope.
export interface MigrationMappingDto {
  sourceDocId: string;
  codaPageId: string;
  codaPageUrl: string;
  migratedSeq: number;
  lastMigratedAt: string;
}

// GET /documents/:docId/coda-mappings row — a live Coda destination this doc has been
// migrated to, for the topbar/sidebar "Open in Coda" action.
export interface DocCodaMappingDto {
  codaPageUrl: string;
  scopeId: string;
  scopeLabel: string;
  lastMigratedAt: string;
}

export type MigrationJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

export type MigrationItemStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

// GET /migration-jobs row — a run's summary + counts (no worker lease internals).
export interface MigrationJobSummary {
  id: string;
  workspaceId: string;
  scopeId: string;
  sourceRootDocId: string;
  status: MigrationJobStatus;
  totalItems: number;
  succeededItems: number;
  failedItems: number;
  skippedItems: number;
  createdById: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// One row of a run — per-doc execution state (never exposes the worker lease).
export interface MigrationJobItem {
  id: string;
  sourceDocId: string;
  plannedParentDocId: string | null;
  title: string;
  targetCodaPageId: string | null;
  override: boolean;
  codaPageId: string | null;
  migratedSeq: number | null;
  status: MigrationItemStatus;
  attempts: number;
  lastError: string | null;
  seq: number;
}

// GET /migration-jobs/:id — the run summary plus its items.
export interface MigrationJobDetail extends MigrationJobSummary {
  items: MigrationJobItem[];
}

// One row of the user-arranged migration plan (the modal's editable preview tree).
export interface MigrationPlanItemInput {
  sourceDocId: string;
  plannedParentDocId?: string | null; // null/omitted = the subtree root
  title: string;
  destinationUrl?: string; // in-scope Coda URL to override/retarget; omit = create new
  include: boolean; // unchecked rows are dropped before enqueue
}

// POST /migration-scopes/:scopeId/jobs body — the arranged plan snapshot.
export interface EnqueueMigrationJobInput {
  items: MigrationPlanItemInput[];
  sourceRootDocId?: string;
}

// POST /migration-scopes/:scopeId/validate-destination body.
export interface ValidateDestinationInput {
  url: string;
}

// POST /migration-scopes/:scopeId/validate-destination result — an invalid/out-of-scope
// URL is a normal {ok:false, reason} response, not an error.
export type ValidateDestinationResult =
  | { ok: true; codaPageId: string }
  | { ok: false; reason: string };
