import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE, API_PREFIX } from '../lib/env';
import { useAuthStore } from '../stores/authStore';
import { ensureRefreshed } from '../lib/http';

// Treat the token as expired a little early so we refresh before the reconnect is rejected.
const EXPIRY_SKEW_MS = 10_000;

type WorkspaceEvent =
  | { type: 'document.created'; document: unknown }
  | { type: 'document.updated'; document: unknown }
  | { type: 'document.deleted'; id: string }
  | { type: 'ping' };

// Subscribe to the workspace's server-sent event stream so the sidebar reflects
// document changes made by other members live. EventSource can't set headers, so
// the access token rides in the query string (the backend guard reads it there).
export function useWorkspaceEvents(workspaceId: string | undefined) {
  const qc = useQueryClient();
  // Re-subscribes with a fresh token whenever it rotates (a stale token would be
  // rejected on the next reconnect).
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!workspaceId || !token) return;
    const url = `${API_BASE}${API_PREFIX}/realtime/workspaces/${encodeURIComponent(
      workspaceId,
    )}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      let msg: WorkspaceEvent;
      try {
        msg = JSON.parse(e.data) as WorkspaceEvent;
      } catch {
        return;
      }
      if (msg.type === 'ping') return;
      // Refetch the workspace doc list; the tree/panel re-render from cache.
      void qc.invalidateQueries({ queryKey: ['documents', workspaceId] });
    };

    // EventSource auto-reconnects, but reuses the token captured in this URL. The backend closes
    // the stream at token expiry, so when that's the cause, refresh once: the rotated token lands
    // in the store, re-running this effect with a fresh connection. Transient blips fall through
    // to EventSource's own retry with the still-valid token.
    es.onerror = () => {
      const { expiresAt, refreshToken } = useAuthStore.getState();
      const expired = expiresAt != null && Date.now() >= expiresAt - EXPIRY_SKEW_MS;
      if (expired && refreshToken) {
        es.close(); // stop retrying on the stale token while the refresh is in flight
        void ensureRefreshed();
      }
    };

    return () => es.close();
  }, [workspaceId, token, qc]);
}
