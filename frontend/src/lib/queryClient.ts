import { QueryCache, QueryClient } from '@tanstack/react-query';
import { isAccessLost, isApiError } from './errors';
import { isWorkspaceScopedKey } from './queryKeys';
import { dropToLauncher } from './scopeGuard';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // A workspace-scoped read that 403/404s means access was revoked
        // mid-session → drop the user back to the launcher gracefully.
        if (isAccessLost(error) && isWorkspaceScopedKey(query.queryKey)) {
          dropToLauncher();
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => {
          // Never retry client errors (auth/permission/validation/conflict).
          if (isApiError(error)) return error.statusCode >= 500 && count < 2;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
