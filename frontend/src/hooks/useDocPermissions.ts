import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { DocumentPermission } from '../types/api';
import type { WorkspaceRole } from '../types/roles';

// Explicit per-page grants on a document (managers only); mirrors the workspace member query + mutations.
export function useDocPermissions(docId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: docId ? qk.docPermissions(docId) : ['documents', '_none', 'permissions'],
    queryFn: () => documentsApi.listPermissions(docId as string),
    enabled: !!docId && enabled,
  });
}

export function useAddDocPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { docId: string; email: string; role: WorkspaceRole }) =>
      documentsApi.addPermission(v.docId, { email: v.email, role: v.role }),
    onSuccess: (_p, v) => qc.invalidateQueries({ queryKey: qk.docPermissions(v.docId) }),
  });
}

export function useUpdateDocPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { docId: string; userId: string; role: WorkspaceRole }) =>
      documentsApi.updatePermission(v.docId, v.userId, v.role),
    onMutate: async ({ docId, userId, role }) => {
      const key = qk.docPermissions(docId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentPermission[]>(key);
      qc.setQueryData<DocumentPermission[]>(key, (old) =>
        old?.map((p) => (p.userId === userId ? { ...p, role } : p)),
      );
      return { prev, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      pushToast({ kind: 'error', message: messageOf(e) });
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: qk.docPermissions(v.docId) }),
  });
}

export function useRemoveDocPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { docId: string; userId: string }) =>
      documentsApi.removePermission(v.docId, v.userId),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.docPermissions(v.docId) }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
