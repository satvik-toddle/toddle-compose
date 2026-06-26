import { apiUrl } from '../lib/env';
import { ApiError } from '../lib/errors';
import { ensureRefreshed, parse, toApiError } from '../lib/http';
import { authState } from '../stores/authStore';

// Shape returned by POST /api/uploads (backend StoredObject).
export interface StoredObject {
  key: string;
  url: string;
  size?: number;
}

// Multipart upload of a single file. The JSON `request` helper can't carry a
// FormData body, so this posts the form directly, reusing the API layer's bearer
// auth, single-flight refresh-and-retry-once, and response parsing/error helpers.
export async function uploadFile(file: Blob, filename?: string, _retry = false): Promise<StoredObject> {
  const form = new FormData();
  // Preserve the original filename so the backend derives the right extension.
  const name = filename ?? (file instanceof File ? file.name : 'upload');
  form.append('file', file, name);

  const headers: Record<string, string> = {};
  const token = authState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl('/uploads'), { method: 'POST', headers, body: form });

  // 401 from an expired access token → single-flight refresh, then retry once.
  const canRefreshAndRetry = res.status === 401 && !_retry && Boolean(authState().refreshToken);
  if (canRefreshAndRetry && (await ensureRefreshed())) {
    return uploadFile(file, filename, true);
  }

  const body = await parse(res);
  if (!res.ok) throw toApiError(res, body);

  // Defensive: a 2xx with an empty/non-JSON body would null-deref `stored.url` in callers.
  const stored = body as StoredObject | null;
  if (!stored || typeof stored.url !== 'string') {
    throw new ApiError(res.status, 'Upload succeeded but the server returned no file URL', undefined, body);
  }
  return stored;
}
