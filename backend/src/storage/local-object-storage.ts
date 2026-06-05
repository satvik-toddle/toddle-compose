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

/**
 * Filesystem-backed ObjectStorage (dev default). Files land in `STORAGE_DIR` and
 * are served back by `UploadsController` at `<BACKEND_PUBLIC_URL>/api/uploads/:key`.
 * Not for production scale — point `STORAGE_DRIVER=s3` at a bucket for that.
 */
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
      return { body, contentType: contentTypeForKey(key), size: body.length };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!isSafeKey(key)) return;
    await rm(this.pathFor(key), { force: true });
  }

  async url(key: string): Promise<string> {
    return `${this.publicBase}/api/uploads/${encodeURIComponent(key)}`;
  }

  private pathFor(key: string): string {
    // isSafeKey guarantees a single, separator-free segment → no traversal.
    return join(this.dir, key);
  }
}
