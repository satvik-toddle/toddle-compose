import { useEffect, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';
import type { SearchResultDto } from '../types/api';

// Snappier than the 500ms Share-picker search — this is a live spotlight, not a directory lookup.
export const DOC_SEARCH_DEBOUNCE_MS = 200;
// Keyset page size — small enough that "load more" engages on modest result sets.
export const DOC_SEARCH_PAGE = 25;

export interface DocSearchTotals {
  total: number;
}

// Debounced, keyset-paginated title + content search. `workspaceId` scopes to one workspace; omit for global.
export function useDocSearch(q: string, workspaceId?: string) {
  const trimmed = q.trim();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), DOC_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  const query = useInfiniteQuery({
    queryKey: qk.docSearch(workspaceId ?? null, debounced),
    queryFn: ({ pageParam }) => documentsApi.search(debounced, workspaceId, DOC_SEARCH_PAGE, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });

  const pages = query.data?.pages ?? [];
  const results: SearchResultDto[] = pages.flatMap((p) => p.items);
  const first = pages[0];
  const totals: DocSearchTotals = { total: first?.total ?? 0 };

  return {
    results,
    totals,
    // First-page fetch or debounce window (next-page fetches surface via isFetchingNextPage).
    isSearching: trimmed !== debounced || (query.isFetching && !query.isFetchingNextPage),
    isError: query.isError,
    error: query.error as unknown,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    // Whether any page has landed for the current (or placeholder-carried) query.
    hasResponse: query.data !== undefined,
  };
}

// Head-of-log preview for the split modal; only fires when `enabled` (in-workspace + toggle ON).
export function useDocPreview(docId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.docPreview(docId ?? ''),
    queryFn: () => documentsApi.preview(docId as string),
    enabled: !!docId && enabled,
    staleTime: 30_000,
  });
}
