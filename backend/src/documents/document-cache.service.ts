import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import type { Env } from "../config/env";

export type CachedDocRow = Record<string, unknown> & { id: string };

export type CachedChildNode = Record<string, unknown> & { id: string };

type Entry = { row: CachedDocRow; expiresAt: number };
type ChildrenEntry = { children: CachedChildNode[]; expiresAt: number };

@Injectable()
export class DocumentCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentCacheService.name);
  private readonly store = new Map<string, Entry>();
  private readonly childrenSnapshotStore = new Map<string, ChildrenEntry>();
  private readonly ttlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttlMs = config.get("DOCUMENT_CACHE_TTL_MS", { infer: true });
  }

  get(id: string): CachedDocRow | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(id);
      return undefined;
    }
    return entry.row;
  }

  set(id: string, row: CachedDocRow): void {
    this.store.set(id, { row, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(id: string): void {
    this.store.delete(id);
  }

  getChildren(parentId: string): CachedChildNode[] | undefined {
    const entry = this.childrenSnapshotStore.get(parentId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.childrenSnapshotStore.delete(parentId);
      return undefined;
    }
    return entry.children;
  }

  setChildren(parentId: string, children: CachedChildNode[]): void {
    this.childrenSnapshotStore.set(parentId, { children, expiresAt: Date.now() + this.ttlMs });
  }

  invalidateChildren(parentId: string): void {
    this.childrenSnapshotStore.delete(parentId);
  }

  @Interval(60_000)
  async sweep(): Promise<void> {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(id);
        removed++;
      }
    }
    for (const [parentId, entry] of this.childrenSnapshotStore) {
      if (entry.expiresAt <= now) {
        this.childrenSnapshotStore.delete(parentId);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`swept ${removed} expired document cache entr${removed === 1 ? "y" : "ies"}`);
    }
  }

  onModuleDestroy(): void {
    this.store.clear();
    this.childrenSnapshotStore.clear();
  }
}
