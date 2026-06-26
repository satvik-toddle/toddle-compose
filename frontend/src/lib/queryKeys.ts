import type { JoinRequestState } from '../types/roles';

// Central query-key factory. Keep all keys here so invalidations stay precise.
export const qk = {
  me: ['me'] as const,
  authConfig: ['authConfig'] as const,
  realm: ['realm'] as const,
  realmMembers: ['realm', 'users'] as const,
  workspaces: ['workspaces'] as const,
  discoverable: ['workspaces', 'discoverable'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  workspaceMembers: (id: string) => ['workspaces', id, 'users'] as const,
  realmRequests: (state: JoinRequestState = 'PENDING') =>
    ['joinRequests', 'realm', state] as const,
  wsRequests: (id: string, state: JoinRequestState = 'PENDING') =>
    ['workspaces', id, 'requests', state] as const,
  documents: (workspaceId: string, folderId?: string | null) =>
    ['documents', workspaceId, folderId ?? null] as const,
  folders: (workspaceId: string) => ['folders', workspaceId] as const,
};

// A query key that becomes invalid when the caller loses access to a workspace
// (used by the global access-lost guard). Excludes the realm-wide listings.
export function isWorkspaceScopedKey(key: readonly unknown[]): boolean {
  if (key[0] === 'documents' || key[0] === 'folders') return true;
  return (
    key[0] === 'workspaces' &&
    typeof key[1] === 'string' &&
    key[1] !== 'discoverable'
  );
}
