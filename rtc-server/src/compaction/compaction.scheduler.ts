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
  private initialTimer: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
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

  async onApplicationBootstrap(): Promise<void> {
    const interval = this.env("RTC_COMPACT_INTERVAL_MS");
    if (interval <= 0) {
      log.info("compaction scheduler disabled (RTC_COMPACT_INTERVAL_MS<=0)");
      return;
    }
    // Persistent schedule: base the next pass on the last recorded run so a process that never survives a full interval still compacts.
    const latest = await this.repo.getLatestCompactionRun().catch((e) => {
      log.error("could not read latest compaction run — assuming none", e);
      return null;
    });
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
    log.info(`compaction scheduler armed: interval=${interval}ms`);
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.tick().finally(() => this.armInterval(interval));
    }, delay);
    this.initialTimer.unref?.();
  }

  private armInterval(interval: number): void {
    this.timer = setInterval(() => void this.tick(), interval);
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
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("compaction scheduler stopped");
  }
}
