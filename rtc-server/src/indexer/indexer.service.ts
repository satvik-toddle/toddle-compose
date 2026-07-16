import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocRepository } from "../persistence/doc-repository.service";
import { SearchIndexWriter } from "./search-index-writer";
import { extractSearchText } from "../persistence/searchable-text";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("indexer");

// Rows drained per claim; a full backlog is drained in a tight loop within one sweep.
const BATCH = 500;
// Concurrent Yjs extractions — the deliberate CPU cost center, kept bounded.
const EXTRACT_CONCURRENCY = 8;

// Detached search indexer. rtc enqueues onto stale_documents and pings /wake; this worker
// coalesces those pings into ONE sweep per INDEXER_INTERVAL_MS window, drains the queue
// (read rtc DB → extract → write backend DB directly, seq-guarded), and idles between runs. A
// slow safety sweep and a startup catch-up cover lost pings / downtime.
@Injectable()
export class IndexerService implements OnApplicationShutdown {
  private readonly intervalMs: number;
  private readonly safetyMs: number;
  private scheduledAt: number | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private safetyTimer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly repo: DocRepository,
    private readonly writer: SearchIndexWriter,
    config: ConfigService<Env, true>
  ) {
    this.intervalMs = config.get("INDEXER_INTERVAL_MS", { infer: true });
    this.safetyMs = config.get("INDEXER_SAFETY_SWEEP_MS", { infer: true });
  }

  start(): void {
    log.info(`indexer up: interval=${this.intervalMs}ms safety=${this.safetyMs}ms batch=${BATCH}`);
    // Catch up on anything enqueued while the worker was down.
    this.trigger("startup");
    // Blind safety net: sweep even if a wake ping was never delivered.
    this.safetyTimer = setInterval(() => this.trigger("safety"), this.safetyMs);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    if (this.safetyTimer) clearInterval(this.safetyTimer);
    await this.inFlight;
  }

  // Wake ping from rtc. Schedules a sweep one interval out (coalescing further pings in the
  // window) and returns when it will run, so rtc can suppress pings until then.
  wake(): { nextRunAt: number } {
    if (this.stopped) return { nextRunAt: Date.now() };
    if (this.scheduledAt === null) {
      this.scheduledAt = Date.now() + this.intervalMs;
      this.scheduleTimer = setTimeout(() => this.fire(), this.intervalMs);
    }
    return { nextRunAt: this.scheduledAt };
  }

  // Run a sweep now (startup/safety), bypassing the coalescing delay.
  private trigger(reason: string): void {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    this.scheduledAt = null;
    void this.fire(reason);
  }

  private fire(reason = "scheduled"): void {
    this.scheduledAt = null;
    this.scheduleTimer = null;
    if (this.running || this.stopped) return; // a run in progress will drain what's queued
    this.running = true;
    this.inFlight = this.drain(reason).finally(() => {
      this.running = false;
    });
  }

  // Drain the queue to empty (or until stopped): claim → read → extract → write → guarded delete.
  private async drain(reason: string): Promise<void> {
    let total = 0;
    const t0 = Date.now();
    try {
      for (;;) {
        if (this.stopped) break;
        const rows = await this.repo.claimStale(BATCH);
        if (rows.length === 0) break;

        const states = await this.repo.getRtcStatesForIndex(rows.map((r) => r.docId));
        const bytesById = new Map(states.map((s) => [s.id, s.yjsState]));
        const items = await mapWithConcurrency(rows, EXTRACT_CONCURRENCY, (row) => {
          const bytes = bytesById.get(row.docId);
          // extractSearchText never throws (returns "" on bad/absent state) — no poison rows.
          const text = bytes ? extractSearchText(new Uint8Array(bytes)) : "";
          return { id: row.docId, text, seq: row.seq };
        });

        // Write first; only clear queue rows AFTER a durable write (throws → rows survive → retry).
        await this.writer.apply(items);
        for (const row of rows) await this.repo.deleteStaleUpTo(row.docId, row.seq);

        total += rows.length;
        if (rows.length < BATCH) break;
      }
      if (total > 0) log.info(`swept ${total} doc(s) (${reason}) in ${Date.now() - t0}ms`);
    } catch (e) {
      log.error(`sweep failed (${reason}): ${e instanceof Error ? e.message : e}`);
    }
  }
}

// Bounded-concurrency map (extraction is CPU-bound; cap keeps the worker from spiking).
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => R | Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
