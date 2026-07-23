import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';
import { foldersApi } from '../api/folders';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { DocumentDto, DocumentType } from '../types/api';

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

// Infinite offset-paged workspace docs; `data` stays a flat deduped DocumentDto[] so all consumers are unaffected while the sidebar lazily loads more.
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

// Single doc by id — for a deep link / search result outside the paginated list. retry off: a 404 means stale id, show it now.
export function useDocument(docId: string | undefined) {
  return useQuery({
    queryKey: docId ? qk.doc(docId) : ['doc', '_none'],
    queryFn: () => documentsApi.get(docId as string),
    enabled: !!docId,
    retry: false,
    staleTime: 30_000,
  });
}

// Resolve the open doc: prefer the paginated list, else fetch it individually. `fetched` is
// the single-doc result (with authoritative breadcrumbs) only when it wasn't in the list.
export function useOpenDoc(docId: string | undefined, list: DocumentDto[]) {
  const fromList = docId ? list.find((d) => d.id === docId) : undefined;
  const single = useDocument(fromList || !docId ? undefined : docId);
  return {
    doc: (fromList ?? single.data) as DocumentDto | undefined,
    fetched: fromList ? undefined : single.data,
    isPending: !fromList && !!docId && single.isPending,
  };
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

// Read-only snapshot of a document at a given update seq (null seq = skip); diffAgainst also fetches the server-computed merged diff.
export function useDocSnapshot(
  docId: string | undefined,
  seq: number | null,
  diffAgainst?: number,
) {
  return useQuery({
    queryKey:
      docId && seq != null
        ? qk.docSnapshot(docId, seq, diffAgainst)
        : ['docHistory', '_none', 'snap'],
    queryFn: () => documentsApi.historyAt(docId as string, seq as number, diffAgainst),
    enabled: !!docId && seq != null,
    // Not immutable: compaction (tier-1 merge / tier-2 archive) rewrites the seq→state mapping, so a
    // cached snapshot can go stale — short staleTime, not Infinity, or a long-lived tab diverges from a fresh load.
    staleTime: 30_000,
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

// Patch one doc across every cached list shape under ['documents', ws] — the infinite
// workspace list ({pages}), the starred list ([]), and any folder-scoped list — plus the
// single-doc ['doc', id] cache. Lets single-field edits skip refetching all loaded pages
// AND keeps an out-of-list doc (served from ['doc', id]) in sync.
function patchDocEverywhere(
  qc: ReturnType<typeof useQueryClient>,
  ws: string,
  id: string,
  patch: (d: DocumentDto) => DocumentDto,
) {
  const applyToList = (old: unknown): unknown => {
    if (Array.isArray(old)) return old.map((d) => (d.id === id ? patch(d) : d));
    if (old && typeof old === 'object' && 'pages' in old) {
      const inf = old as { pages: DocumentDto[][] };
      return { ...inf, pages: inf.pages.map((pg) => pg.map((d) => (d.id === id ? patch(d) : d))) };
    }
    return old;
  };
  qc.setQueriesData({ queryKey: ['documents', ws] }, applyToList);
  qc.setQueryData(qk.doc(id), (old) => (old ? patch(old as DocumentDto) : old));
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

// Star when currently unstarred, unstar otherwise. Patch isStarred in place (no full list
// refetch) and invalidate only the starred list, whose membership actually changed.
export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { workspaceId: string; id: string; isStarred: boolean }) => {
      if (v.isStarred) await documentsApi.unstar(v.id);
      else await documentsApi.star(v.id);
    },
    onSuccess: (_d, v) => {
      patchDocEverywhere(qc, v.workspaceId, v.id, (d) => ({ ...d, isStarred: !v.isStarred }));
      qc.invalidateQueries({ queryKey: qk.starredDocuments(v.workspaceId) });
    },
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

// Title change: patch title + the server's new updatedAt into the list caches (so the row
// re-sorts by recency without a full refetch), then invalidate the single-doc cache so its
// breadcrumb leaf title refreshes (patching can't reach the nested breadcrumbs[] entry).
export function useRenameDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; title: string }) =>
      documentsApi.rename(v.id, v.title),
    onSuccess: (updated, v) => {
      patchDocEverywhere(qc, v.workspaceId, v.id, (d) => ({
        ...d,
        title: v.title,
        updatedAt: updated.updatedAt,
      }));
      qc.invalidateQueries({ queryKey: qk.doc(v.id) });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useDeleteDocument() {
  const { docs, qc } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string }) => documentsApi.remove(v.id),
    onSuccess: (_d, v) => {
      // Drop the single-doc cache so an out-of-list open doc resolves to "not found" instead
      // of rendering the deleted page (its subtree cascade is covered by the list invalidate).
      qc.removeQueries({ queryKey: qk.doc(v.id) });
      docs(v.workspaceId);
    },
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
  const { docs, qc } = useInvalidatePages();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; folderId: string | null }) =>
      documentsApi.move(v.id, { folderId: v.folderId }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.doc(v.id) }); // parent/folder changed
      docs(v.workspaceId);
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
