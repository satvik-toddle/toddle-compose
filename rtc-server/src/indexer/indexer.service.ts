import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { DocRepository } from "../persistence/doc-repository.service";
import { BackendInternalClient } from "../persistence/backend-internal.client";
import { extractSearchText } from "../persistence/searchable-text";
import { createLogger } from "../logger";

const log = createLogger("indexer");

// Rows drained per sweep. Batching is mandatory: a large backlog drained one-by-one is minutes
// slower than in bulk (see search-indexing.md §6).
const BATCH = 500;
// Idle pause between sweeps when the queue was empty (loop-with-delay, not setInterval — a new
// sweep starts only after the previous finishes, so backlog degrades freshness linearly).
const SWEEP_MS = 2000;
// Concurrent Yjs extractions — the deliberate CPU cost center, kept bounded.
const EXTRACT_CONCURRENCY = 8;

// Detached search indexer: drains the rtc stale_documents queue, extracts each doc's plain
// text from its Yjs snapshot, and pushes the batch to the backend's seq-guarded index endpoint.
// Runs as its OWN process (indexer/main.ts) so extraction CPU never touches the WS event loop.
@Injectable()
export class IndexerService implements OnApplicationShutdown {
  private running = false;
  private loopDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: DocRepository,
    private readonly backend: BackendInternalClient
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    log.info(`search indexer started (batch=${BATCH}, sweep=${SWEEP_MS}ms)`);
    this.loopDone = this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopDone;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let drainedFull = false;
      try {
        drainedFull = await this.sweep();
      } catch (e) {
        log.error(`sweep failed: ${e instanceof Error ? e.message : e}`);
      }
      // Keep draining a backlog with no pause; only sleep once the queue is (near) empty.
      if (!drainedFull) await sleep(SWEEP_MS);
    }
  }

  // One drain pass. Returns true when a full batch was taken (backlog remains → keep going).
  private async sweep(): Promise<boolean> {
    const rows = await this.repo.claimStale(BATCH);
    if (rows.length === 0) return false;

    const t0 = Date.now();
    const states = await this.repo.getRtcStatesForIndex(rows.map((r) => r.docId));
    const stateById = new Map(states.map((s) => [s.id, s.yjsState]));

    const items = await mapWithConcurrency(rows, EXTRACT_CONCURRENCY, (row) => {
      const bytes = stateById.get(row.docId);
      // extractSearchText never throws (returns "" on bad/absent state) — no poison rows.
      const text = bytes ? extractSearchText(new Uint8Array(bytes)) : "";
      if (text.length === 0) log.debug(`empty extraction for '${row.docId}' seq=${row.seq}`);
      return { id: row.docId, text, seq: row.seq };
    });

    // Push first; only clear queue rows AFTER a successful push (throws → rows survive → retry).
    await this.backend.pushContentBulk(items);
    for (const row of rows) await this.repo.deleteStaleUpTo(row.docId, row.seq);

    log.info(`indexed ${rows.length} doc(s) in ${Date.now() - t0}ms`);
    return rows.length === BATCH;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
