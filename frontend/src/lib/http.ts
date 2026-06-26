import { apiUrl } from './env';
import { ApiError } from './errors';
import { authState } from '../stores/authStore';
import type { AuthResponse, EnterWorkspaceResponse, User } from '../types/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach the bearer token (default true)
  signal?: AbortSignal;
  _retry?: boolean; // internal: set after a refresh so we retry only once
}

// Read a response body as JSON, falling back to raw text (and null when empty).
async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Normalize any failed response into an ApiError. NestJS may return `message` as
// a string or an array of validation strings; both collapse to one message here.
function toApiError(res: Response, body: unknown): ApiError {
  let message = res.statusText || 'Request failed';
  let error: string | undefined;
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    if (Array.isArray(b.message)) message = b.message.join(', ');
    else if (typeof b.message === 'string') message = b.message;
    if (typeof b.error === 'string') error = b.error;
  } else if (typeof body === 'string' && body) {
    message = body;
  }
  return new ApiError(res.status, message, error, body);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal, _retry = false } = opts;
  const headers: Record<string, string> = {};
  // FormData sets its own multipart Content-Type (with boundary); only JSON needs it set.
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = authState().accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    signal,
  });

  // Expired access token → single-flight refresh, then retry once.
  if (res.status === 401 && auth && !_retry && authState().refreshToken) {
    const ok = await ensureRefreshed();
    if (ok) return request<T>(path, { ...opts, _retry: true });
  }

  if (!res.ok) throw toApiError(res, await parse(res));
  return (await parse(res)) as T;
}

// Raw POST that bypasses the refresh machinery (used by the refresh itself).
async function rawPost<T>(path: string, body?: unknown, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = await parse(res);
  if (!res.ok) throw toApiError(res, parsed);
  return parsed as T;
}

let refreshPromise: Promise<boolean> | null = null;

// Concurrent 401s share ONE refresh — the refresh token rotates and reuse
// triggers a server-side family-kill, so parallel refreshes must be avoided.
export function ensureRefreshed(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
  const { refreshToken, activeWorkspaceId } = authState();
  if (!refreshToken) return false;

  let res: AuthResponse;
  try {
    res = await rawPost<AuthResponse>('/auth/refresh', { refreshToken }, undefined);
  } catch {
    // Invalid/used refresh token → family-kill. Hard logout; never retry refresh.
    authState().clearSession();
    return false;
  }
  authState().applyTokens(
    { accessToken: res.accessToken, refreshToken: res.refreshToken, expiresIn: res.expiresIn },
    res.user,
  );

  // A plain refresh drops the activeWorkspaceId claim — re-enter to restore scope.
  if (activeWorkspaceId) {
    await reEnter(activeWorkspaceId, res.accessToken);
  }
  return true;
}

async function reEnter(workspaceId: string, accessToken: string): Promise<void> {
  try {
    const ent = await rawPost<EnterWorkspaceResponse>(
      '/auth/workspace/enter',
      { workspaceId },
      accessToken,
    );
    authState().applyTokens({ accessToken: ent.accessToken, expiresIn: ent.expiresIn });
    authState().setScope(ent.workspaceId, ent.role);
  } catch {
    // Access revoked mid-session → drop scope (the route layer surfaces this as
    // removed-mid-session) but keep the session alive.
    authState().clearScopeLocal();
  }
}

// Cold-boot: restore the session from the persisted refresh token, then restore
// the last active workspace scope if there was one.
export async function bootstrapAuth(): Promise<void> {
  const { refreshToken, lastActiveWorkspaceId } = authState();
  if (!refreshToken) {
    authState().setStatus('anon');
    return;
  }
  const ok = await ensureRefreshed();
  if (!ok) {
    authState().setStatus('anon');
    return;
  }
  if (lastActiveWorkspaceId && !authState().activeWorkspaceId) {
    const token = authState().accessToken;
    if (token) await reEnter(lastActiveWorkspaceId, token);
  }
  try {
    const me = await request<{ user: User }>('/auth/me');
    authState().setUser(me.user);
  } catch {
    // tokens are valid; a /me hiccup is non-fatal
  }
  authState().setStatus('authed');
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'DELETE' }),
};
