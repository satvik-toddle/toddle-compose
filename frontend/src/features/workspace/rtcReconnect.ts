// Structural match for y-websocket's WebsocketProvider (the doc editor bundles
// its own copy, so a nominal type would not cover all three call sites).
type ProviderLike = {
  on: (event: string, cb: (...args: any[]) => void) => void;
  off: (event: string, cb: (...args: any[]) => void) => void;
};

// Reconnect/re-auth hardening shared by the doc, sheet, and whiteboard providers.
// Every failed attempt ends in 'connection-close'; the rtc-server rejects
// invalidated tokens at the HTTP upgrade too (401 → browser close code 1006, not
// 4001), so a client that missed a live kick would otherwise loop on its cached
// token until the periodic refetch. 4001 = server force-refreshed access:
// re-mint immediately. Otherwise count each attempt once (one attempt can emit
// both 'connection-error' and 'connection-close') and re-mint every 2 consecutive
// failures (covers a re-mint rejected once for iat <= watermark within the kick's
// same second). The fresh token reaches the provider because call sites mutate
// the params object y-websocket re-reads on every reconnect.
// `onFailure` receives the consecutive-failure count since the last successful
// connect (not reset by re-mints), for "can't reach the server" UI.
// `state` lets a caller persist the failure counters across provider recreation:
// the doc editor's providerFactory can be re-invoked (StrictMode, collab re-memo)
// mid-streak, and the 2-failure re-mint guarantee must not reset each time. Omit it
// (sheet/whiteboard) to use per-call locals — those hold one provider per session.
// Returns a detach function; call sites that destroy the provider may skip it.
export type TokenRecoveryState = {
  sinceRemint: number;
  sinceConnect: number;
  attemptCounted: boolean;
};

export function attachTokenRecovery(
  provider: ProviderLike,
  refetchToken: () => unknown,
  onFailure?: (consecutiveFailures: number) => void,
  state?: TokenRecoveryState,
): () => void {
  const s: TokenRecoveryState =
    state ?? { sinceRemint: 0, sinceConnect: 0, attemptCounted: false };

  const onStatus = (e?: { status?: string }) => {
    if (e?.status === 'connecting') s.attemptCounted = false;
    else if (e?.status === 'connected') {
      s.sinceRemint = 0;
      s.sinceConnect = 0;
    }
  };
  const onSync = (isSynced: boolean) => {
    if (isSynced) {
      s.sinceRemint = 0;
      s.sinceConnect = 0;
    }
  };
  const onConnectFailure = (code?: number) => {
    // One attempt can emit both 'connection-error' and 'connection-close'; count it
    // once. 4001s still count toward sinceConnect so a server stuck force-refreshing
    // access surfaces the "can't reach the server" UI instead of looping silently.
    if (s.attemptCounted) return;
    s.attemptCounted = true;
    s.sinceConnect += 1;
    if (code === 4001) {
      // Server force-refreshed access: re-mint immediately, don't wait for 2.
      s.sinceRemint = 0;
      void refetchToken();
    } else {
      s.sinceRemint += 1;
      if (s.sinceRemint >= 2) {
        s.sinceRemint = 0;
        void refetchToken();
      }
    }
    onFailure?.(s.sinceConnect);
  };
  const onClose = (e?: CloseEvent) => onConnectFailure(e?.code);
  const onError = () => onConnectFailure();

  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose);
  provider.on('connection-error', onError);
  return () => {
    provider.off('status', onStatus);
    provider.off('sync', onSync);
    provider.off('connection-close', onClose);
    provider.off('connection-error', onError);
  };
}
