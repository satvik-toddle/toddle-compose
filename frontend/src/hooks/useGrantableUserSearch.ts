import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { documentsApi } from '../api/documents';

// Per user request; 300ms is the usual default if this should feel snappier.
export const SEARCH_DEBOUNCE_MS = 500;

// Debounced doc-scoped user search for the Share picker; gated server-side on doc-manage
// (not realm membership) so a doc-ADMIN grantee who never joined a workspace can still find
// people. Typed terms fire SEARCH_DEBOUNCE_MS after typing stops, while an empty term fetches
// the first-20 initial list immediately. Same returned shape as useRealmUserSearch (drop-in).
export function useGrantableUserSearch(docId: string, term: string) {
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

  // Enabled once we have a docId; an empty term fetches the initial list (cached under its own key).
  const query = useQuery({
    queryKey: qk.grantableUserSearch(docId, debounced),
    queryFn: () => documentsApi.searchGrantableUsers(docId, debounced),
    enabled: !!docId,
    staleTime: 30_000,
  });

  // Spinner covers the debounce window too, so a "typed but not yet fired" search doesn't look dead.
  const isSearching = trimmed !== debounced || query.isFetching;

  return { users: query.data ?? [], isSearching, error: query.error };
}
