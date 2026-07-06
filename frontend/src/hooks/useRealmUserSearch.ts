import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { realmApi } from '../api/realm';

// Per user request; 300ms is the usual default if this should feel snappier.
export const SEARCH_DEBOUNCE_MS = 3000;

// Debounced realm member-directory search for pickers. The caller owns the raw
// input; typed terms fire SEARCH_DEBOUNCE_MS after typing stops, while an empty
// term fetches the first-20 initial list immediately.
export function useRealmUserSearch(term: string) {
  const trimmed = term.trim();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    // Empty term (initial open / cleared input) skips the debounce so the first-20 list shows at once.
    if (!trimmed) {
      setDebounced('');
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  // Always enabled: an empty term fetches the initial list (cached under its own key).
  const query = useQuery({
    queryKey: qk.realmUserSearch(debounced),
    queryFn: () => realmApi.searchUsers(debounced),
    staleTime: 30_000,
  });

  // Spinner covers the debounce window too — with a long debounce, "typed but not
  // yet fired" would otherwise look dead.
  const isSearching = trimmed !== debounced || query.isFetching;

  return { users: query.data ?? [], isSearching, error: query.error };
}
