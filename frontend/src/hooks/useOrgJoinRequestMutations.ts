import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { realmApi } from '../api/realm';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';

// Request to join the organisation (realm).
export function useRequestJoinOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => realmApi.requestJoinOrg(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myOrgRequest });
      pushToast({ kind: 'success', message: 'Request sent — an admin will review it.' });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useApproveOrgRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => realmApi.approveOrgRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.orgRequests() });
      qc.invalidateQueries({ queryKey: qk.realmMembers });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRejectOrgRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => realmApi.rejectOrgRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.orgRequests() }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
