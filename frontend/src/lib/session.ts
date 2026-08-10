import type { QueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { authState } from '../stores/authStore';
import { isWorkspaceScopedKey, qk } from './queryKeys';

// Drop cached data scoped to a workspace — after a token swap it may be stale or
// now-forbidden, so force a refetch under the new scope.
export function dropWorkspaceScopedQueries(qc: QueryClient): void {
  qc.removeQueries({ predicate: (q) => isWorkspaceScopedKey(q.queryKey) });
}

// Enter a workspace: re-mint the scoped access token, record scope, reset caches.
export async function enterWorkspaceScope(qc: QueryClient, workspaceId: string) {
  const res = await authApi.enter(workspaceId);
  authState().applyTokens({ accessToken: res.accessToken, expiresIn: res.expiresIn });
  authState().setScope(res.workspaceId, res.role);
  dropWorkspaceScopedQueries(qc);
  return res;
}

export async function leaveWorkspaceScope(qc: QueryClient): Promise<void> {
  const res = await authApi.leave();
  authState().applyTokens({ accessToken: res.accessToken, expiresIn: res.expiresIn });
  authState().leaveScope();
  dropWorkspaceScopedQueries(qc);
  qc.invalidateQueries({ queryKey: qk.workspaces });
}

export async function performLogout(qc: QueryClient): Promise<void> {
  const rt = authState().refreshToken;
  authState().clearSession();
  qc.clear();
  if (rt) authApi.logout(rt).catch(() => {});
}
