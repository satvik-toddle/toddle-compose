import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import type { Env } from "../config/env";

// The cached value is exactly the `summarySelect()` shape returned by DocumentsService —
// kept generic here so the service stays the single source of truth for that projection.
export type CachedDocRow = Record<string, unknown> & { id: string };

type Entry = { row: CachedDocRow; expiresAt: number };

/**
 * In-memory, TTL-bounded cache of document metadata rows keyed by document id.
 *
 * Reads serve a fresh entry without touching the DB; on miss/expiry the caller reloads
 * and calls `set`. Writes are write-through: the mutating service commits to the DB first,
 * then `set`s the returned row so the next reader sees the update (or `invalidate`s on delete).
 *
 * Per-instance like the throttler store — N replicas keep N independent copies, each
 * self-healing within DOCUMENT_CACHE_TTL_MS. It caches row DATA only, never an authorization
 * decision: callers still gate every read per-user against the cached row.
 */
@Injectable()
export class DocumentCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentCacheService.name);
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttlMs = config.get("DOCUMENT_CACHE_TTL_MS", { infer: true });
  }

  // Fresh row, or undefined on miss/expiry (an expired entry is dropped on read).
  get(id: string): CachedDocRow | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(id);
      return undefined;
    }
    return entry.row;
  }

  // Cache `row` (write-through after a committed DB read/write), resetting its staleness window.
  set(id: string, row: CachedDocRow): void {
    this.store.set(id, { row, expiresAt: Date.now() + this.ttlMs });
  }

  // Drop a single entry (after delete, or to force a reload).
  invalidate(id: string): void {
    this.store.delete(id);
  }

  // Sweep expired entries so ids that are never read again don't pin memory forever.
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
    if (removed > 0) {
      this.logger.debug(`swept ${removed} expired document cache entr${removed === 1 ? "y" : "ies"}`);
    }
  }

  onModuleDestroy(): void {
    this.store.clear();
  }
}
