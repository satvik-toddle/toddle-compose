import { ApiError } from '../lib/errors';
import { http } from '../lib/http';

// Shape returned by POST /api/uploads (backend StoredObject).
export interface StoredObject {
  key: string;
  url: string;
  size?: number;
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
