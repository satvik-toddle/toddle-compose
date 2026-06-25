import { apiUrl } from '../lib/env';
import { ApiError } from '../lib/errors';
import { ensureRefreshed } from '../lib/http';
import { authState } from '../stores/authStore';

// Shape returned by POST /api/uploads (backend StoredObject).
export interface StoredObject {
  key: string;
  url: string;
  size?: number;
}

// Multipart upload of a single file. The JSON `request` helper can't carry a
// FormData body (it forces Content-Type: application/json), so this posts the
// multipart form directly while reusing the bearer token + single-flight
// refresh-and-retry-once behaviour of the rest of the API layer.
export async function uploadFile(file: Blob, filename?: string, _retry = false): Promise<StoredObject> {
  const form = new FormData();
  // Preserve the original filename so the backend derives the right extension.
  const name = filename ?? (file instanceof File ? file.name : 'upload');
  form.append('file', file, name);

  const headers: Record<string, string> = {};
  const token = authState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl('/uploads'), { method: 'POST', headers, body: form });

  if (res.status === 401 && !_retry && authState().refreshToken) {
    const ok = await ensureRefreshed();
    if (ok) return uploadFile(file, filename, true);
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const b = body as { message?: unknown; error?: unknown } | null;
    const message =
      b && typeof b.message === 'string' ? b.message : res.statusText || 'Upload failed';
    const error = b && typeof b.error === 'string' ? b.error : undefined;
    throw new ApiError(res.status, message, error, body);
  }
  return body as StoredObject;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
