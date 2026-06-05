// Tiny fetch wrapper for the backend (NestJS, /api prefix on :4000).
// Access tokens are short-lived (~15 min); on a 401 we transparently exchange
// the refresh token for a new pair and retry the original request once.
const BASE =
  (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000/api';

const TOKEN_KEY = 'tc_token';
const REFRESH_KEY = 'tc_refresh';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getRefresh(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefresh(t: string | null) {
  if (t) localStorage.setItem(REFRESH_KEY, t);
  else localStorage.removeItem(REFRESH_KEY);
}
/** Persist a token pair from login/register/refresh in one shot. */
export function setSession(accessToken: string | null, refreshToken?: string | null) {
  setToken(accessToken);
  if (refreshToken !== undefined) setRefresh(refreshToken);
}

export type ApiError = { status: number; data: any };

/**
 * Exchange the refresh token for a fresh pair. Single-flighted: the backend
 * ROTATES refresh tokens and treats reuse of an already-rotated token as theft
 * (revoking the whole family), so concurrent 401s must await the SAME refresh
 * rather than each presenting the now-stale token. Returns true on success.
 */
let inflight: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const refreshToken = getRefresh();
    if (!refreshToken) return false;
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.accessToken) return false;
      setSession(data.accessToken, data.refreshToken ?? refreshToken);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

async function rawFetch(path: string, method: string, body: any, token: string | null, auth: boolean) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token && auth) headers.Authorization = `Bearer ${token}`;
  return fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function api(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<any> {
  const method = opts.method || 'GET';
  const auth = opts.auth !== false;

  let res = await rawFetch(path, method, opts.body, getToken(), auth);

  // Access token expired (or rejected) → try one refresh + retry.
  const refreshable = auth && path !== '/auth/refresh' && getRefresh();
  if (res.status === 401 && refreshable) {
    const ok = await refreshSession();
    if (ok) {
      res = await rawFetch(path, method, opts.body, getToken(), auth);
    } else {
      // Refresh failed → session is dead. Clear it and let the app fall back to login.
      setSession(null, null);
      window.dispatchEvent(new Event('tc-auth-expired'));
    }
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw { status: res.status, data } as ApiError;
  return data;
}

// Lists may come back as an array or { items, total, nextCursor }.
export function asRows(d: any): any[] {
  if (Array.isArray(d)) return d;
  return d?.items ?? d?.data ?? d?.users ?? d?.requests ?? d?.workspaces ?? [];
}
