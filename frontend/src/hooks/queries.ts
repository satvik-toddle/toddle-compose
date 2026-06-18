import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { realmApi } from '../api/realm';
import { workspacesApi } from '../api/workspaces';
import { joinApi } from '../api/joinRequests';
import { useAuthStore } from '../stores/authStore';

const useAuthed = () => useAuthStore((s) => s.status === 'authed');

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
