import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CompactionService } from "./compaction.service";
import { DocRepository } from "../persistence/doc-repository.service";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("compact");

// Settle delay before the first pass, so startup traffic quiesces before compaction begins.
const FIRST_PASS_SETTLE_MS = 30_000;

@Injectable()
export class CompactionScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  // Set on shutdown so an in-flight first-pass lookup or tick never re-arms the timer.
  private stopped = false;
  // Guards against overlapping passes racing on the same doc's seq range (replaceSeqRangeWithMerged).
  private running = false;

  constructor(
    private readonly compaction: CompactionService,
    private readonly repo: DocRepository,
    private readonly config: ConfigService<Env, true>
  ) {}

  private env<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  onApplicationBootstrap(): void {
    const interval = this.env("RTC_COMPACT_INTERVAL_MS");
    if (interval <= 0) {
      log.info("compaction scheduler disabled (RTC_COMPACT_INTERVAL_MS<=0)");
      return;
    }
    log.info(`compaction scheduler armed: interval=${interval}ms`);
    // Fire the DB lookup WITHOUT awaiting so app.listen / WS availability never gates on it.
    // Persistent schedule: base the first pass on the last recorded run so a process that never survives a full interval still compacts.
    void this.repo
      .getLatestCompactionRun()
      .catch((e) => {
        log.error("could not read latest compaction run — assuming none", e);
        return null;
      })
      .then((latest) => {
        if (this.stopped) return;
        let delay: number;
        if (!latest) {
          delay = FIRST_PASS_SETTLE_MS;
          log.info(
            `no prior compaction run — first pass in ${Math.round(delay / 1000)}s`
          );
        } else {
          // Measure from startedAt so a crashed run without finishedAt still counts as an attempt (no tight boot-loop).
          const elapsed = Date.now() - Number(latest.startedAt);
          if (elapsed >= interval) {
            delay = FIRST_PASS_SETTLE_MS;
            log.info(
              `last compaction run ${Math.round(elapsed / 60000)}min ago — first pass in ${Math.round(delay / 1000)}s`
            );
          } else {
            delay = interval - elapsed;
            log.info(
              `last compaction run ${Math.round(elapsed / 60000)}min ago — first pass in ${Math.round(delay / 60000)}m`
            );
          }
        }
        this.schedule(delay, interval);
      });
  }

  // One self-re-arming timer: after each pass, schedule the next at the full interval.
  private schedule(delay: number, interval: number): void {
    this.timer = setTimeout(async () => {
      await this.tick();
      if (!this.stopped) this.schedule(interval, interval);
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      log.warn("previous compaction pass still running — skipping this tick");
      return;
    }
    this.running = true;
    // Bookkeeping is wrapped so a DB hiccup recording the run never kills the pass itself.
    let runId: bigint | null = null;
    try {
      runId = await this.repo.recordCompactionRunStart(Date.now());
    } catch (e) {
      log.error("could not record compaction run start", e);
    }
    try {
      const totals = await this.compaction.runCompactionPass();
      if (runId !== null) {
        await this.repo
          .finishCompactionRun(runId, {
            finishedAt: Date.now(),
            docsScanned: totals.docsScanned,
            tier1SessionsMerged: totals.tier1SessionsMerged,
            tier2DocsArchived: totals.tier2DocsArchived,
            errors: totals.errors,
          })
          .catch((e) => log.error("could not record compaction run finish", e));
      }
    } catch (e) {
      log.error("compaction pass FAILED", e);
    } finally {
      this.running = false;
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Only log when the scheduler was actually armed (a disabled scheduler never scheduled anything).
    if (this.env("RTC_COMPACT_INTERVAL_MS") > 0) {
      log.info("compaction scheduler stopped");
    }
  }
}
