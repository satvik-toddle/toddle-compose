import { useRef } from 'react';
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RTC_WS_URL } from '../../lib/env';
import { attachTokenRecovery } from './rtcReconnect';

// Shared RTC-provider plumbing for the realtime page editors (sheet, whiteboard),
// so the reconnect/re-auth/teardown handshake lives in one place instead of being
// re-implemented per editor.

// Holds the token/refetch in refs: y-websocket re-reads params.token on every
// reconnect, so a re-minted token stays live without tearing the doc down.
export type RtcParams = {
  paramsRef: { current: { token: string } };
  refetchTokenRef: { current: () => Promise<unknown> };
};

export function useRtcParams(token: string, refetchToken: () => Promise<unknown>): RtcParams {
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;
  const refetchTokenRef = useRef(refetchToken);
  refetchTokenRef.current = refetchToken;
  // Stable identity so callers can pass this into effect deps without re-running.
  const rtcRef = useRef<RtcParams>({ paramsRef, refetchTokenRef });
  return rtcRef.current;
}

// Opens a provider for `ydoc` and attaches the shared token recovery. `onFailure`
// receives the consecutive-failure count for "can't reach the server" UI. Returns
// the provider and a teardown that detaches recovery and destroys the provider
// (the caller still owns the ydoc's lifecycle).
export function connectRtcProvider(
  docId: string,
  ydoc: Y.Doc,
  { paramsRef, refetchTokenRef }: RtcParams,
  onFailure?: (consecutiveFailures: number) => void,
) {
  const provider = new WebsocketProvider(RTC_WS_URL, docId, ydoc, {
    params: paramsRef.current,
    connect: true,
  });
  const detachRecovery = attachTokenRecovery(
    provider,
    () => refetchTokenRef.current?.(),
    onFailure,
  );
  const teardown = () => {
    detachRecovery();
    provider.destroy();
  };
  return { provider, teardown };
}
