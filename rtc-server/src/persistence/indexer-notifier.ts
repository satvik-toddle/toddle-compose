import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("indexer");

// Optimistic debounce before the worker's real nextRunAt lands, so a burst pings once.
const PING_DEBOUNCE_MS = 250;
// Longer suppression when the worker is unreachable/erroring, so a sustained flush doesn't hammer it.
const PING_BACKOFF_MS = 5_000;

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
    this.suppressUntil = now + PING_DEBOUNCE_MS;
    void this.ping();
  }

  private async ping(): Promise<void> {
    try {
      const res = await fetch(this.wakeUrl, { method: "POST" });
      if (!res.ok) {
        log.warn(`wake → ${res.status}`);
        this.suppressUntil = Date.now() + PING_BACKOFF_MS;
        return;
      }
      const body = (await res.json()) as { nextRunAt?: number };
      if (typeof body.nextRunAt === "number") this.suppressUntil = body.nextRunAt;
    } catch (e) {
      // Worker down/unreachable: back off (its safety sweep still drains the queue) so a sustained
      // flush doesn't re-ping every debounce window while it's down.
      this.suppressUntil = Date.now() + PING_BACKOFF_MS;
      log.warn(`wake failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
