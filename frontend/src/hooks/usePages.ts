import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';
import { foldersApi } from '../api/folders';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { DocumentType } from '../types/api';

// ---- queries ----
export function useFolders(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceId ? qk.folders(workspaceId) : ['folders', '_none'],
    queryFn: () => foldersApi.list(workspaceId as string),
    enabled: !!workspaceId && enabled,
  });
}

// Server page size for the workspace docs list (the backend caps take at 100).
const DOCS_PAGE = 100;

// Infinite offset-paged workspace docs. `data` stays a flat DocumentDto[] so existing
// consumers (sidebar tree, topbar breadcrumb, search paths) are unaffected; the sidebar
// drives fetchNextPage from a scroll sentinel to lazily load large workspaces.
export function useDocuments(workspaceId: string | undefined, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: workspaceId ? qk.documents(workspaceId) : ['documents', '_none'],
    queryFn: ({ pageParam }) => documentsApi.list(workspaceId as string, pageParam, DOCS_PAGE),
    initialPageParam: 0,
    // Next skip = rows fetched so far; a short page means the end was reached.
    getNextPageParam: (last, all) =>
      last.length === DOCS_PAGE ? all.reduce((n, p) => n + p.length, 0) : undefined,
    enabled: !!workspaceId && enabled,
  });
  // Flatten + dedupe by id — offset pages can shift when docs update between fetches.
  const data = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flat().filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }, [query.data]);
  return { ...query, data };
}

// Single doc by id — used when a deep link / search result points at a doc that isn't in
// the paginated workspace list. Retries are off: a 404 means stale id, show it immediately.
export function useDocument(docId: string | undefined) {
  return useQuery({
    queryKey: docId ? qk.doc(docId) : ['doc', '_none'],
    queryFn: () => documentsApi.get(docId as string),
    enabled: !!docId,
    retry: false,
    staleTime: 30_000,
  });
}

export function useStarredDocuments(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceId ? qk.starredDocuments(workspaceId) : ['documents', '_none', 'starred'],
    queryFn: () => documentsApi.listStarred(workspaceId as string),
    enabled: !!workspaceId && enabled,
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

export function useMoveDocument() {
  const { docs } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; folderId: string | null }) =>
      documentsApi.move(v.id, { folderId: v.folderId }),
    onSuccess: (_d, v) => docs(v.workspaceId),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
