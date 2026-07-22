import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Env } from "../config/env";
import {
  contentTypeForKey,
  isSafeKey,
  makeObjectKey,
  type FetchedObject,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
} from "./object-storage";

// Filesystem-backed ObjectStorage (dev default); not for production scale.
@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly logger = new Logger(LocalObjectStorage.name);
  private readonly dir: string;
  private readonly publicBase: string;

  constructor(config: ConfigService<Env, true>) {
    this.dir = resolve(config.get("STORAGE_DIR", { infer: true }));
    this.publicBase = config
      .get("BACKEND_PUBLIC_URL", { infer: true })
      .replace(/\/+$/, "");
    this.logger.log(`local object storage at ${this.dir}`);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    await mkdir(this.dir, { recursive: true });
    const key = makeObjectKey(input.filename);
    await writeFile(this.pathFor(key), input.body);
    // Persist the real content type in a sidecar; keys without a mapped extension
    // (e.g. an uploaded video whose original name lacked one) would otherwise serve
    // as application/octet-stream and force a download instead of previewing.
    await writeFile(this.pathFor(`${key}.type`), input.contentType).catch(() => {});
    return {
      key,
      url: await this.url(key),
      contentType: input.contentType,
      size: input.body.length,
    };
  }

  async get(key: string): Promise<FetchedObject | null> {
    if (!isSafeKey(key)) return null;
    try {
      const body = await readFile(this.pathFor(key));
      // Prefer the persisted type; fall back to the extension map for legacy files.
      const contentType = await readFile(this.pathFor(`${key}.type`), "utf8")
        .then((s) => s.trim())
        .catch(() => contentTypeForKey(key));
      return { body, contentType: contentType || contentTypeForKey(key), size: body.length };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!isSafeKey(key)) return;
    await rm(this.pathFor(key), { force: true });
    await rm(this.pathFor(`${key}.type`), { force: true });
  }

  async url(key: string): Promise<string> {
    return `${this.publicBase}/api/uploads/${encodeURIComponent(key)}`;
  }

  private pathFor(key: string): string {
    // isSafeKey guarantees a single, separator-free segment → no traversal.
    return join(this.dir, key);
  }
}
