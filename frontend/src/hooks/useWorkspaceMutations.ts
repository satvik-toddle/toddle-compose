import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { qk } from '../lib/queryKeys';
import { workspacesApi } from '../api/workspaces';
import { enterWorkspaceScope, leaveWorkspaceScope } from '../lib/session';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import { authState } from '../stores/authStore';
import type { Visibility, WorkspaceRole } from '../types/roles';

export function useCreateWorkspace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (b: { name: string; visibility?: Visibility; defaultRole?: WorkspaceRole }) =>
      workspacesApi.create(b),
    onSuccess: async (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      // Creator becomes ADMIN and drops straight into the new workspace.
      await enterWorkspaceScope(qc, ws.id);
      navigate(`/w/${ws.id}`);
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    // The backend Workspace has no icon field; the emoji is decorative only.
    mutationFn: (v: { id: string; name: string }) => workspacesApi.update(v.id, { name: v.name }),
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      qc.invalidateQueries({ queryKey: qk.workspace(ws.id) });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.remove(id),
    onSuccess: async (_res, id) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      // If we're currently inside the deleted workspace, leave scope.
      if (authState().activeWorkspaceId === id) {
        await leaveWorkspaceScope(qc).catch(() => authState().leaveScope());
      }
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
