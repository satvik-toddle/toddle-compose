import { randomUUID } from "node:crypto";
import { extname } from "node:path";

/**
 * Object-storage abstraction.
 *
 * Consumers depend ONLY on the `ObjectStorage` interface (injected via the
 * `OBJECT_STORAGE` token), never on a concrete driver. Today there are two
 * implementations — `LocalObjectStorage` (filesystem, dev default) and
 * `S3ObjectStorage` (AWS S3 / MinIO / R2). Selecting the driver is a config
 * flag (`STORAGE_DRIVER`); swapping it requires no changes to callers. Adding a
 * new backend later (GCS, Azure Blob, …) means implementing this one interface.
 */

/** Nest DI token for the configured ObjectStorage implementation. */
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export type PutObjectInput = {
  /** Original client filename — used to derive the stored key's extension. */
  filename: string;
  /** MIME type to store/serve the object as. */
  contentType: string;
  /** The file contents. */
  body: Buffer;
};

export type StoredObject = {
  /** Opaque storage key (also the path segment the GET route serves). */
  key: string;
  /** Absolute URL a browser can fetch the object from. */
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
  /** Store bytes; returns the key + a fetchable URL. */
  put(input: PutObjectInput): Promise<StoredObject>;
  /** Read an object back, or null if it doesn't exist. */
  get(key: string): Promise<FetchedObject | null>;
  /** Remove an object. Idempotent — deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
  /** Absolute URL the browser uses to GET the object (public path or signed URL). */
  url(key: string): Promise<string>;
}

/**
 * Generate an unguessable, single-segment storage key that preserves the
 * original file extension (so content-type can be inferred on read, and so URLs
 * look sensible). Never contains a path separator — safe to use as a route param.
 */
export function makeObjectKey(filename: string): string {
  const ext = extname(filename || "")
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 12);
  return `${randomUUID()}${ext}`;
}

/**
 * Reject keys that could escape the storage root (path traversal) or span
 * directories. Keys we mint are a single UUID-based segment, so anything else
 * is hostile or malformed.
 */
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
