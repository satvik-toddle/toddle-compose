import type { JoinRequestState } from '../types/roles';

// Central query-key factory. Keep all keys here so invalidations stay precise.
export const qk = {
  me: ['me'] as const,
  authConfig: ['authConfig'] as const,
  realm: ['realm'] as const,
  realmMembers: ['realm', 'users'] as const,
  realmUserSearch: (q: string) => ['realm', 'users', 'search', q] as const,
  workspaces: ['workspaces'] as const,
  discoverable: ['workspaces', 'discoverable'] as const,
  myRequests: ['joinRequests', 'mine'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  workspaceMembers: (id: string) => ['workspaces', id, 'users'] as const,
  realmRequests: (state: JoinRequestState = 'PENDING') =>
    ['joinRequests', 'realm', state] as const,
  wsRequests: (id: string, state: JoinRequestState = 'PENDING') =>
    ['workspaces', id, 'requests', state] as const,
  documents: (workspaceId: string, folderId?: string | null) =>
    ['documents', workspaceId, folderId ?? null] as const,
  starredDocuments: (workspaceId: string) => ['documents', workspaceId, 'starred'] as const, // Shares the ['documents', workspaceId] prefix so a docs invalidation also refreshes it.
  allSharedDocuments: () => ['documents', 'shared-with-me'] as const, // Global (cross-workspace) shared list.
  docPermissions: (docId: string) => ['documents', docId, 'permissions'] as const,
  grantableUserSearch: (docId: string, q: string) =>
    ['documents', docId, 'grantable-users', q] as const,
  docShareLink: (docId: string) => ['documents', docId, 'shareLink'] as const,
  shareLink: (token: string) => ['shareLink', token] as const, // public /link/:token resolve
  shareLinkRtc: (token: string) => ['shareLink', token, 'rtc'] as const,
  folders: (workspaceId: string) => ['folders', workspaceId] as const,
  docHistory: (docId: string) => ['docHistory', docId] as const,
  docSnapshot: (docId: string, seq: number, diffAgainst?: number) =>
    ['docHistory', docId, seq, diffAgainst ?? null] as const,

  // Copy to Coda / migrations. Destinations (scopes) and mappings are workspace-scoped;
  // the org-wide admin-console listings (no workspaceId) are not.
  migrationScopes: (workspaceId?: string) => ['migrationScopes', workspaceId ?? null] as const,
  migrationMappings: (scopeId: string, docIds: string[]) =>
    ['migrationScopes', scopeId, 'mappings', [...docIds].sort()] as const,
  docCodaMappings: (docId: string) =>
    ['migrationScopes', 'docMappings', docId] as const,
  migrationJobs: (params: { workspaceId?: string }) =>
    ['migrationJobs', params.workspaceId ?? null] as const,
  migrationJob: (id: string) => ['migrationJobs', 'detail', id] as const,

  // Import from Coda (realm-admin, org-wide — imports create a new workspace).
  codaImportJobs: ['codaImportJobs'] as const,
  codaImportJob: (id: string) => ['codaImportJobs', 'detail', id] as const,
  codaImportCredentials: ['codaImportCredentials'] as const,
};

// A query key that becomes invalid when the caller loses access to a workspace
// (used by the global access-lost guard). Excludes the realm-wide listings.
export function isWorkspaceScopedKey(key: readonly unknown[]): boolean {
  if (key[0] === 'documents' || key[0] === 'folders') return true;
  // Migration scopes/mappings/jobs tied to a workspace (or a scope/job within it):
  // a string second segment is a workspaceId / scopeId / 'detail'; a null second
  // segment is the realm-wide admin-console listing, which is not workspace-scoped.
  // The per-document 'docMappings' read is NOT workspace-scoped: a single doc's
  // coda-mappings 403/404 must not drop the whole workspace session.
  if (key[0] === 'migrationScopes' || key[0] === 'migrationJobs') {
    return typeof key[1] === 'string' && key[1] !== 'docMappings';
  }
  return (
    key[0] === 'workspaces' &&
    typeof key[1] === 'string' &&
    key[1] !== 'discoverable'
  );
}
