import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

// Best-effort wake-up for the "Import from Coda" worker (Phase 7): POST /run so a
// freshly-enqueued job is picked up immediately instead of on the next self-arm
// tick. Mirrors RtcInternalClient's transport (native fetch, AbortSignal.timeout,
// shared X-Internal-Token). Fire-and-forget: never throws to the caller — a down
// or unconfigured worker must not fail an enqueue, since the worker also polls.
@Injectable()
export class CodaImportWorkerClient {
  private readonly log = new Logger("CodaImportWorkerClient");

  constructor(private readonly config: ConfigService<Env, true>) {}

  async ping(): Promise<void> {
    const base = this.config.get("IMPORT_WORKER_URL", { infer: true });
    // No worker URL configured — the worker self-arms on its own timer.
    if (!base) {
      this.log.debug("IMPORT_WORKER_URL unset; skipping worker ping");
      return;
    }
    try {
      const res = await fetch(`${base}/run`, {
        method: "POST",
        headers: {
          "X-Internal-Token": this.config.get("INTERNAL_TOKEN", { infer: true }),
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        this.log.warn(`worker ping → ${res.status} (worker will self-arm on its next tick)`);
      }
    } catch (e) {
      this.log.warn(
        `worker ping failed (worker will self-arm on its next tick): ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }
}
