import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { authApi } from '../api/auth';
import { realmApi } from '../api/realm';
import { workspacesApi } from '../api/workspaces';
import { joinApi } from '../api/joinRequests';
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
// stops once nothing is pending, is bounded so a request an admin never actions
// can't poll indefinitely, and never runs while the tab is backgrounded.
const MY_REQUESTS_POLL_MS = 4000;
const MY_REQUESTS_MAX_POLLS = 75; // ~5 min, then fall back to focus/manual refetch
export function useMyJoinRequests(enabled = true) {
  return useQuery({
    queryKey: qk.myRequests,
    queryFn: joinApi.myRequests,
    enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      const pending = (q.state.data ?? []).some((r) => r.state === 'PENDING');
      if (!pending || q.state.dataUpdateCount >= MY_REQUESTS_MAX_POLLS) return false;
      return MY_REQUESTS_POLL_MS;
    },
  });
}

export function useRealmJoinRequests(enabled = true) {
  return useQuery({
    queryKey: qk.realmRequests('PENDING'),
    queryFn: () => joinApi.realmRequests('PENDING'),
    enabled,
  });
}

export function useWorkspaceJoinRequests(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? qk.wsRequests(id, 'PENDING') : ['workspaces', '_none', 'requests'],
    queryFn: () => joinApi.wsRequests(id as string, 'PENDING'),
    enabled: !!id && enabled,
  });
}
