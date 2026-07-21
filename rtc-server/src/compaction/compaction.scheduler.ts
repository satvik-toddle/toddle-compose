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
  private interval = 0;
  // True once the scheduler is armed; gates the shutdown log (a disabled scheduler never armed).
  private armed = false;
  // Set on shutdown so an in-flight bootstrap never arms the timer after teardown.
  private stopped = false;

  constructor(
    private readonly compaction: CompactionService,
    private readonly repo: DocRepository,
    private readonly config: ConfigService<Env, true>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.interval = this.config.get("RTC_COMPACT_INTERVAL_MS", { infer: true });
    if (this.interval <= 0) {
      log.info("compaction scheduler disabled (RTC_COMPACT_INTERVAL_MS<=0)");
      return;
    }

    // rtc_compaction_runs must exist (rtc schema pushed). If it can't be read, DISABLE the
    // scheduler and log FATAL rather than aborting boot: crash-looping the whole rtc-server
    // (all live collab websockets) over compaction bookkeeping is a far worse failure than
    // running without compaction until the schema push lands.
    let latest: Awaited<ReturnType<DocRepository["getLatestCompactionRun"]>>;
    try {
      latest = await this.repo.getLatestCompactionRun();
    } catch (e) {
      log.error(
        "FATAL: cannot read rtc_compaction_runs — compaction DISABLED until the rtc schema is pushed (pnpm --filter @app/rtc-database exec prisma db push) and the service restarts",
        e
      );
      return;
    }
    if (this.stopped) return;

    this.armed = true;
    log.info(`compaction scheduler armed: interval=${this.interval}ms`);

    // One delay expression for every case: no prior run (elapsed=Infinity), caught up
    // (elapsed>=interval), mid-interval, and clock step-back (negative elapsed). The settle
    // floor protects the reconnect window; the interval cap bounds a backward clock jump.
    const elapsed = latest ? Date.now() - Number(latest.startedAt) : Infinity;
    const delay = Math.min(
      this.interval,
      Math.max(FIRST_PASS_SETTLE_MS, this.interval - elapsed)
    );
    log.info(
      latest
        ? `last compaction run ~${Math.round(elapsed / 60000)}min ago — first pass in ${Math.round(delay / 1000)}s`
        : `no prior compaction run — first pass in ${Math.round(delay / 1000)}s`
    );
    this.schedule(delay);
  }

  // One self-re-arming timer: after each pass, schedule the next at the full interval. The chain
  // awaits tick() before re-arming, so passes never overlap (no separate running-guard needed).
  private schedule(delay: number): void {
    this.timer = setTimeout(async () => {
      await this.tick();
      if (!this.stopped) this.schedule(this.interval);
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    // Bookkeeping is wrapped so a transient DB hiccup recording the run never kills the pass.
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
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.armed) log.info("compaction scheduler stopped");
  }
}
