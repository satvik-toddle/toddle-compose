import { randomUUID } from "node:crypto";
import { extname } from "node:path";

// Consumers depend only on this interface; the driver is chosen by STORAGE_DRIVER config.

/** Nest DI token for the configured ObjectStorage implementation. */
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export type PutObjectInput = {
  // Original client filename — used to derive the stored key's extension.
  filename: string;
  contentType: string;
  body: Buffer;
};

export type StoredObject = {
  // Opaque storage key (also the path segment the GET route serves).
  key: string;
  url: string;
  contentType: string;
  size: number;
};

export type FetchedObject = {
  body: Buffer;
  contentType: string;
  size: number;
};

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  /** Read an object back, or null if it doesn't exist. */
  get(key: string): Promise<FetchedObject | null>;
  /** Idempotent — deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
  /** Public path or signed URL the browser uses to GET the object. */
  url(key: string): Promise<string>;
}

// Unguessable single-segment key preserving the file extension; safe as a route param.
export function makeObjectKey(filename: string): string {
  const ext = extname(filename || "")
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 12);
  return `${randomUUID()}${ext}`;
}

// Reject keys that could escape the storage root via path traversal or directory spans.
export function isSafeKey(key: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(key) && key !== "." && key !== "..";
}

/** Minimal extension → MIME map for serving the local driver's files. */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
};

export function contentTypeForKey(key: string): string {
  return MIME_BY_EXT[extname(key).toLowerCase()] ?? "application/octet-stream";
}
