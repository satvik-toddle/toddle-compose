import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DocRepository } from "./doc-repository.service";
import { extractSearchText } from "./searchable-text";
import { createLogger } from "../logger";

const log = createLogger("backfill");

// DB page size for scanning missing rows; each row is still processed one at a time.
const BATCH = 50;

// On startup, ensure every persisted doc has a content_text projection for search.
// Rows written before content_text existed have it NULL; fill them SEQUENTIALLY and
// block readiness until done, so search returns complete results the moment we serve.
@Injectable()
export class ContentBackfillService implements OnApplicationBootstrap {
  constructor(private readonly repo: DocRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      // Never let a backfill failure stop the server from coming up.
      log.error("content_text backfill FAILED", e);
    }
  }

  private async run(): Promise<void> {
    const total = await this.repo.countDocsMissingContentText();
    if (total === 0) {
      log.info("content_text backfill: all rows already have content — skipping");
      return;
    }
    log.info(`content_text backfill: ${total} found without content_text`);

    let afterId: string | null = null;
    let done = 0;
    let withText = 0;
    for (;;) {
      const batch = await this.repo.listDocsMissingContentText(afterId, BATCH);
      if (batch.length === 0) break;
      for (const doc of batch) {
        afterId = doc.id;
        const text = doc.yjsState
          ? extractSearchText(new Uint8Array(doc.yjsState))
          : "";
        try {
          await this.repo.setContentText(doc.id, text);
          if (text.length > 0) withText += 1;
        } catch (e) {
          log.warn(`content_text backfill: '${doc.id}' update failed`, e);
        }
        done += 1;
        log.info(`content_text backfill: ${done}/${total} done ('${doc.id}' ${text.length}ch)`);
      }
    }
    log.info(`content_text backfill complete: ${done}/${total} filled, ${withText} with text`);
  }
}
