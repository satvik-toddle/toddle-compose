import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";
import { IndexerNotifier } from "./indexer-notifier";

// Search-index population moved OUT of the collab server into the detached indexer worker
// (indexer/main.ts): the flush tx enqueues onto stale_documents, then IndexerNotifier pings the
// worker to drain it. No inline extraction/push or boot backfill here anymore.
@Module({
  imports: [CompactionModule],
  providers: [DocStateService, IndexerNotifier],
  exports: [DocStateService],
})
export class PersistenceModule {}
