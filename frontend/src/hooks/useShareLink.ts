import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi } from '../api/documents';
import { shareLinksApi } from '../api/shareLinks';
import { qk } from '../lib/queryKeys';
import { isNotFound } from '../lib/errors';
import type { ShareLinkScope } from '../types/api';
import type { WorkspaceRole } from '../types/roles';

// The doc's share link, or null when none exists yet (a 404 is "no link", not an error).
export function useShareLink(docId: string, enabled = true) {
  return useQuery({
    queryKey: qk.docShareLink(docId),
    queryFn: async () => {
      try {
        return await documentsApi.getShareLink(docId);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    enabled: enabled && !!docId,
  });
}

// Create/update the link (role + scope).
export function usePutShareLink(docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { role: WorkspaceRole; scope: ShareLinkScope }) =>
      documentsApi.putShareLink(docId, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.docShareLink(docId) }),
  });
}

export function useRegenerateShareLink(docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => documentsApi.regenerateShareLink(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.docShareLink(docId) }),
  });
}

// Revoke the link.
export function useDeleteShareLink(docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => documentsApi.deleteShareLink(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.docShareLink(docId) }),
  });
}

// Apply access changes now: kick everyone live on the doc so they re-mint a token against current
// permissions. No query invalidation — the effect is server-side on the RTC connections.
export function useRefreshDocAccess(docId: string) {
  return useMutation({
    mutationFn: () => documentsApi.refreshAccess(docId),
  });
}

// Global (cross-workspace) list of pages shared with the current user — for the launcher panel.
export function useAllSharedDocuments(enabled = true) {
  return useQuery({
    queryKey: qk.allSharedDocuments(),
    queryFn: () => documentsApi.listAllSharedWithMe(),
    enabled,
  });
}

// Public link resolve (/link/:token) — 404 surfaces as an error, 401 for a REALM link viewed logged-out.
export function useShareLinkResolve(token: string) {
  return useQuery({
    queryKey: qk.shareLink(token),
    queryFn: () => shareLinksApi.resolve(token),
    enabled: !!token,
    retry: false,
  });
}

// RTC token minted through a link (mirrors useRtcToken's cadence) for the standalone doc view.
export function useShareLinkRtcToken(token: string | undefined) {
  return useQuery({
    queryKey: token ? qk.shareLinkRtc(token) : ['shareLink', '_none', 'rtc'],
    queryFn: () => shareLinksApi.rtcToken(token as string),
    enabled: !!token,
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
    refetchIntervalInBackground: true,
    gcTime: 0,
    retry: false,
  });
}
