// Cross-tab auth sync over BroadcastChannel. Because the refresh token rotates
// (and reuse triggers a server-side family-kill), sibling tabs must NOT refresh
// independently — instead they adopt tokens broadcast by whichever tab refreshed.
export type AuthBroadcast =
  | { type: 'tokens'; accessToken: string; refreshToken: string; expiresIn: number; user?: unknown }
  | { type: 'logout' };

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel === null && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('tc-auth');
  }
  return channel;
}

export function postAuthMessage(msg: AuthBroadcast): void {
  getChannel()?.postMessage(msg);
}

export function subscribeAuthMessages(cb: (msg: AuthBroadcast) => void): () => void {
  const c = getChannel();
  if (!c) return () => {};
  const handler = (e: MessageEvent) => cb(e.data as AuthBroadcast);
  c.addEventListener('message', handler);
  return () => c.removeEventListener('message', handler);
}
