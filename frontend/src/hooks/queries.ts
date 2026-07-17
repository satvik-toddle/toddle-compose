import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { authApi } from '../api/auth';
import { realmApi } from '../api/realm';
import { workspacesApi } from '../api/workspaces';
import { joinApi } from '../api/joinRequests';
import { personalAccessTokensApi } from '../api/personalAccessTokens';
import { useAuthStore } from '../stores/authStore';

const useAuthed = () => useAuthStore((s) => s.status === 'authed');

// Public deployment config (e.g. whether password reset is available); cached for the session.
export function useAuthConfig() {
  return useQuery({
    queryKey: qk.authConfig,
    queryFn: authApi.config,
    staleTime: Infinity,
  });
}

export function useRealm() {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.realm, queryFn: realmApi.get, enabled: authed });
}

export function useRealmMembers(enabled = true) {
  return useQuery({ queryKey: qk.realmMembers, queryFn: realmApi.listUsers, enabled });
}

export function useWorkspaces() {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.workspaces, queryFn: workspacesApi.list, enabled: authed });
}

export function useDiscoverableWorkspaces(enabled = true) {
  return useQuery({ queryKey: qk.discoverable, queryFn: workspacesApi.discoverable, enabled });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: id ? qk.workspace(id) : ['workspaces', '_none'],
    queryFn: () => workspacesApi.get(id as string),
    enabled: !!id,
  });
}

export function useWorkspaceMembers(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? qk.workspaceMembers(id) : ['workspaces', '_none', 'users'],
    queryFn: () => workspacesApi.listMembers(id as string),
    enabled: !!id && enabled,
  });
}

// The caller's own join requests. While any are PENDING it polls so an approval
// (granted by an admin elsewhere) is picked up without a manual refresh. Polling
// stops once nothing is pending and never runs while the tab is backgrounded.
const MY_REQUESTS_POLL_MS = 4000;
export function useMyJoinRequests(enabled = true) {
  return useQuery({
    queryKey: qk.myRequests,
    queryFn: joinApi.myRequests,
    enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((request) => request.state === 'PENDING')
        ? MY_REQUESTS_POLL_MS
        : false,
  });
}

export function useRealmJoinRequests(enabled = true) {
  return useQuery({
    queryKey: qk.realmRequests('PENDING'),
    queryFn: () => joinApi.realmRequests('PENDING'),
    enabled,
  });
}

// The caller's own access tokens (all scopes). Gated so it only fires where the
// tokens UI is actually shown (workspace admins).
export function usePersonalAccessTokens(enabled = true) {
  return useQuery({ queryKey: qk.personalAccessTokens, queryFn: personalAccessTokensApi.list, enabled });
}

export function useWorkspaceJoinRequests(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? qk.wsRequests(id, 'PENDING') : ['workspaces', '_none', 'requests'],
    queryFn: () => joinApi.wsRequests(id as string, 'PENDING'),
    enabled: !!id && enabled,
  });
}
