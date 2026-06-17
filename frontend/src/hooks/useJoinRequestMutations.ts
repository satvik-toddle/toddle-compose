import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { qk } from '../lib/queryKeys';
import { joinApi } from '../api/joinRequests';
import { enterWorkspaceScope } from '../lib/session';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { WorkspaceRole } from '../types/roles';

// Join a public workspace, then enter it.
export function useJoinPublicWorkspace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (workspaceId: string) => joinApi.joinPublic(workspaceId),
    onSuccess: async (_m, workspaceId) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      qc.invalidateQueries({ queryKey: qk.discoverable });
      await enterWorkspaceScope(qc, workspaceId);
      navigate(`/w/${workspaceId}`);
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

// Request access to a private workspace.
export function useRequestAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; requestedRole?: WorkspaceRole }) =>
      joinApi.request(v.workspaceId, v.requestedRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.discoverable });
      pushToast({ kind: 'success', message: 'Request sent — an admin will review it.' });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; requestId: string; role?: WorkspaceRole }) =>
      joinApi.approve(v.workspaceId, v.requestId, v.role),
    onSuccess: (_m, v) => {
      qc.invalidateQueries({ queryKey: qk.wsRequests(v.workspaceId) });
      qc.invalidateQueries({ queryKey: qk.realmRequests() });
      qc.invalidateQueries({ queryKey: qk.workspaceMembers(v.workspaceId) });
      qc.invalidateQueries({ queryKey: qk.realmMembers });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; requestId: string }) =>
      joinApi.reject(v.workspaceId, v.requestId),
    onSuccess: (_m, v) => {
      qc.invalidateQueries({ queryKey: qk.wsRequests(v.workspaceId) });
      qc.invalidateQueries({ queryKey: qk.realmRequests() });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
