import { ApiError } from '../lib/errors';
import { apiUrl } from '../lib/env';
import { http, ensureRefreshed } from '../lib/http';
import { authState } from '../stores/authStore';

// Shape returned by POST /api/uploads (backend StoredObject).
export interface StoredObject {
  key: string;
  url: string;
  size?: number;
}

export interface UploadProgressOpts {
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

// Collapse a NestJS error body ({message:string|string[]}) into one ApiError, like http.ts does for fetch.
function xhrError(status: number, body: unknown): ApiError {
  let message = 'Upload failed';
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown };
    if (Array.isArray(b.message)) message = b.message.join(', ');
    else if (typeof b.message === 'string') message = b.message;
  } else if (typeof body === 'string' && body) {
    message = body;
  }
  return new ApiError(status, message, undefined, body);
}

// One XHR POST attempt; resolves with the raw status + parsed body (never rejects on HTTP status,
// only on transport/abort) so the caller can branch on 401 for a token refresh + retry.
function postOnce(
  form: FormData,
  token: string | undefined,
  opts: UploadProgressOpts,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/uploads'));
    // FormData sets its own multipart Content-Type (with boundary) — don't set it here.
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // XHR is the ONLY way to observe upload progress (fetch can't); this is why /uploads bypasses http.ts.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = xhr.responseText;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'));
    if (opts.signal) {
      if (opts.signal.aborted) return xhr.abort();
      opts.signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(form);
  });
}

// Multipart upload with real upload-progress events. Mirrors uploadFile's auth (bearer + single
// refresh-retry on 401) but over XHR so the caller gets a live byte-progress callback.
export async function uploadFileWithProgress(
  file: Blob,
  filename: string | undefined,
  opts: UploadProgressOpts = {},
): Promise<StoredObject> {
  const build = () => {
    const form = new FormData();
    const name = filename ?? (file instanceof File ? file.name : 'upload');
    form.append('file', file, name);
    return form;
  };

  let token = authState().accessToken ?? undefined;
  let { status, body } = await postOnce(build(), token, opts);
  if (status === 401 && authState().refreshToken) {
    const ok = await ensureRefreshed();
    if (ok) {
      token = authState().accessToken ?? undefined;
      ({ status, body } = await postOnce(build(), token, opts));
    }
  }
  if (status < 200 || status >= 300) throw xhrError(status, body);

  const stored = body as StoredObject | null;
  if (!stored || typeof stored.url !== 'string') {
    throw new ApiError(0, 'Upload succeeded but the server returned no file URL', undefined, stored);
  }
  return stored;
}

// Multipart upload of a single file via the shared `request` layer (bearer auth + refresh-retry; FormData sets its own boundary).
export async function uploadFile(file: Blob, filename?: string): Promise<StoredObject> {
  const form = new FormData();
  // Preserve the original filename so the backend derives the right extension.
  const name = filename ?? (file instanceof File ? file.name : 'upload');
  form.append('file', file, name);

  const stored = await http.post<StoredObject | null>('/uploads', form);
  // Defensive: a 2xx with an empty/non-JSON body would null-deref `stored.url` in callers.
  if (!stored || typeof stored.url !== 'string') {
    throw new ApiError(0, 'Upload succeeded but the server returned no file URL', undefined, stored);
  }
  return stored;
}
