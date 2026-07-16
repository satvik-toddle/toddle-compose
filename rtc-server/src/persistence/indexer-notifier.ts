import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("indexer");

// Wakes the detached indexer after a flush enqueues onto stale_documents. Debounced against the
// worker's returned nextRunAt: once a sweep is scheduled, further pings in that window are
// skipped (the worker coalesces all queued docs into that run anyway). Fire-and-forget — a lost
// ping is harmless, the worker's safety sweep catches it.
@Injectable()
export class IndexerNotifier {
  private readonly wakeUrl: string;
  private suppressUntil = 0;

  constructor(config: ConfigService<Env, true>) {
    this.wakeUrl = config.get("INDEXER_WAKE_URL", { infer: true });
  }

  notify(): void {
    const now = Date.now();
    if (now < this.suppressUntil) return; // a run is already scheduled within this window
    // Optimistically suppress for the interval so a burst pings once even before the reply lands.
    this.suppressUntil = now + 250;
    void this.ping();
  }

  private async ping(): Promise<void> {
    try {
      const res = await fetch(this.wakeUrl, { method: "POST" });
      if (!res.ok) {
        log.warn(`wake → ${res.status}`);
        return;
      }
      const body = (await res.json()) as { nextRunAt?: number };
      if (typeof body.nextRunAt === "number") this.suppressUntil = body.nextRunAt;
    } catch (e) {
      // Worker down/unreachable: its safety sweep will still drain the queue.
      log.warn(`wake failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
