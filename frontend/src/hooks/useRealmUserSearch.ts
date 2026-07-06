import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { realmApi } from '../api/realm';

// Per user request; 300ms is the usual default if this should feel snappier.
export const SEARCH_DEBOUNCE_MS = 3000;

// Debounced realm member-directory search for pickers. The caller owns the raw
// input; the query fires SEARCH_DEBOUNCE_MS after typing stops, on non-empty terms.
export function useRealmUserSearch(term: string) {
  const trimmed = term.trim();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    // Clearing the input drops results immediately instead of after the debounce.
    if (!trimmed) {
      setDebounced('');
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  const query = useQuery({
    queryKey: qk.realmUserSearch(debounced),
    queryFn: () => realmApi.searchUsers(debounced),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  // Spinner covers the debounce window too — with a long debounce, "typed but not
  // yet fired" would otherwise look dead.
  const isSearching = (!!trimmed && trimmed !== debounced) || (query.isFetching && !!debounced);

  return { users: query.data ?? [], isSearching, error: query.error };
}
