import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CompactionService } from "./compaction.service";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("compact");

@Injectable()
export class CompactionScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  // Guards against overlapping passes racing on the same doc's seq range (replaceSeqRangeWithMerged).
  private running = false;

  constructor(
    private readonly compaction: CompactionService,
    private readonly config: ConfigService<Env, true>
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.get("RTC_COMPACT_INTERVAL_MS", { infer: true });
    if (interval <= 0) {
      log.info("compaction scheduler disabled (RTC_COMPACT_INTERVAL_MS<=0)");
      return;
    }
    log.info(`compaction scheduler armed: interval=${interval}ms`);
    this.timer = setInterval(() => {
      if (this.running) {
        log.warn("previous compaction pass still running — skipping this tick");
        return;
      }
      this.running = true;
      this.compaction
        .runCompactionPass()
        .catch((e) => log.error("compaction pass FAILED", e))
        .finally(() => {
          this.running = false;
        });
    }, interval);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("compaction scheduler stopped");
    }
  }
}
