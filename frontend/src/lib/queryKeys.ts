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
  docSearch: (workspaceId: string | null, q: string) =>
    ['docSearch', workspaceId ?? 'global', q] as const,
  docPreview: (docId: string) => ['docPreview', docId] as const,
};

// A query key that becomes invalid when the caller loses access to a workspace
// (used by the global access-lost guard). Excludes the realm-wide listings.
export function isWorkspaceScopedKey(key: readonly unknown[]): boolean {
  // docPreview is deliberately excluded: a 403/404 there means ONE stale search result
  // (doc deleted / grant revoked), not lost workspace access — the pane shows its own error.
  if (key[0] === 'documents' || key[0] === 'folders' || key[0] === 'docSearch') return true;
  return (
    key[0] === 'workspaces' &&
    typeof key[1] === 'string' &&
    key[1] !== 'discoverable'
  );
}
