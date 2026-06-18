import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { workspacesApi } from '../api/workspaces';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { WorkspaceMember } from '../types/api';
import type { WorkspaceRole } from '../types/roles';

export function useAddWorkspaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; email: string; role: WorkspaceRole }) =>
      workspacesApi.addMember(v.workspaceId, { email: v.email, role: v.role }),
    onSuccess: (_m, v) =>
      qc.invalidateQueries({ queryKey: qk.workspaceMembers(v.workspaceId) }),
  });
}

export function useSetWorkspaceMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; userId: string; role: WorkspaceRole }) =>
      workspacesApi.setMemberRole(v.workspaceId, v.userId, v.role),
    onMutate: async ({ workspaceId, userId, role }) => {
      const key = qk.workspaceMembers(workspaceId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<WorkspaceMember[]>(key);
      qc.setQueryData<WorkspaceMember[]>(key, (old) =>
        old?.map((m) => (m.userId === userId ? { ...m, role } : m)),
      );
      return { prev, key };
    },
    onError: (e, _v, ctx) => {
      // e.g. 409 "can't demote the last admin"
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      pushToast({ kind: 'error', message: messageOf(e) });
    },
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: qk.workspaceMembers(v.workspaceId) }),
  });
}

export function useRemoveWorkspaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; userId: string }) =>
      workspacesApi.removeMember(v.workspaceId, v.userId),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.workspaceMembers(v.workspaceId) }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
