import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';
import { foldersApi } from '../api/folders';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { Visibility } from '../types/roles';
import type { DocumentType } from '../types/api';

// ---- queries ----
export function useFolders(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceId ? qk.folders(workspaceId) : ['folders', '_none'],
    queryFn: () => foldersApi.list(workspaceId as string),
    enabled: !!workspaceId && enabled,
  });
}

export function useDocuments(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceId ? qk.documents(workspaceId) : ['documents', '_none'],
    queryFn: () => documentsApi.list(workspaceId as string),
    enabled: !!workspaceId && enabled,
  });
}

export function useStarredDocuments(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceId ? qk.starredDocuments(workspaceId) : ['documents', '_none', 'starred'],
    queryFn: () => documentsApi.listStarred(workspaceId as string),
    enabled: !!workspaceId && enabled,
  });
}

// Version-history timeline (edit sessions, newest first) for an open document.
export function useDocHistory(docId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: docId ? qk.docHistory(docId) : ['docHistory', '_none'],
    queryFn: () => documentsApi.history(docId as string),
    enabled: !!docId && enabled,
  });
}

// Read-only snapshot of a document at a given update seq (null seq = skip).
export function useDocSnapshot(docId: string | undefined, seq: number | null) {
  return useQuery({
    queryKey: docId && seq != null ? qk.docSnapshot(docId, seq) : ['docHistory', '_none', 'snap'],
    queryFn: () => documentsApi.historyAt(docId as string, seq as number),
    enabled: !!docId && seq != null,
    staleTime: Infinity, // a past snapshot is immutable
  });
}

// Mint an RTC token for real-time collaboration on a document (Yjs/rtc-server).
export function useRtcToken(docId: string | undefined) {
  return useQuery({
    queryKey: docId ? ['rtcToken', docId] : ['rtcToken', '_none'],
    queryFn: () => documentsApi.rtcToken(docId as string),
    enabled: !!docId,
    staleTime: 4 * 60_000, // token TTL ~5min
    // Re-mint before expiry (focus refetch is globally off): the post-exp reconnect reads the fresh token via DocEditor's paramsRef.
    refetchInterval: 4 * 60_000,
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}

// ---- mutations (workspaceId carried for invalidation) ----
function useInvalidatePages() {
  const qc = useQueryClient();
  return {
    qc,
    docs: (ws: string) => qc.invalidateQueries({ queryKey: ['documents', ws] }),
    folders: (ws: string) => qc.invalidateQueries({ queryKey: ['folders', ws] }),
  };
}

export function useCreateDocument() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: {
      workspaceId: string;
      parentId?: string | null;
      folderId?: string | null;
      title?: string;
      type?: DocumentType;
    }) => documentsApi.create(v),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

// Star when currently unstarred, unstar otherwise; docs invalidation refreshes the starred list.
export function useToggleStar() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: async (v: { workspaceId: string; id: string; isStarred: boolean }) => {
      if (v.isStarred) await documentsApi.unstar(v.id);
      else await documentsApi.star(v.id);
    },
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useCreateFolder() {
  const { folders } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; parentId?: string | null; name: string }) =>
      foldersApi.create(v),
    onSuccess: (_d, v) => folders(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRenameDocument() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; title: string }) =>
      documentsApi.rename(v.id, v.title),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRenameFolder() {
  const { folders } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; name: string }) =>
      foldersApi.rename(v.id, { name: v.name }),
    onSuccess: (_d, v) => folders(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useDeleteDocument() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string }) => documentsApi.remove(v.id),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useDeleteFolder() {
  const { docs, folders } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string }) => foldersApi.remove(v.id),
    onSuccess: (_d, v) => {
      folders(v.workspaceId);
      docs(v.workspaceId); // a deleted folder's docs detach
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useSetDocumentVisibility() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; visibility: Visibility }) =>
      documentsApi.setVisibility(v.id, v.visibility),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useMoveDocument() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; folderId: string | null }) =>
      documentsApi.move(v.id, { folderId: v.folderId }),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
