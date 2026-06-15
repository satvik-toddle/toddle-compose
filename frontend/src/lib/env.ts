// Base URL for API calls. Empty string means "use the Vite dev proxy" (same
// origin → /api/...). Set VITE_API_BASE_URL for a non-proxied deployment.
export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? '';

// All backend routes are mounted under the global `/api` prefix.
export const API_PREFIX = '/api';

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${API_PREFIX}${p}`;
}
