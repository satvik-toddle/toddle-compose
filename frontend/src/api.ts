// Tiny fetch wrapper for the backend (NestJS, /api prefix on :4000).
const BASE =
  (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000/api';

export function getToken(): string | null {
  return localStorage.getItem('tc_token');
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem('tc_token', t);
  else localStorage.removeItem('tc_token');
}

export type ApiError = { status: number; data: any };

export async function api(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t && opts.auth !== false) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

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
