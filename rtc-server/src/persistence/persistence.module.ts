import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";

// Search-index population moved OUT of the collab server into the detached indexer worker
// (indexer/main.ts): the flush tx enqueues onto stale_documents, the worker drains it. No
// inline extraction/push or boot backfill here anymore.
@Module({
  imports: [CompactionModule],
  providers: [DocStateService],
  exports: [DocStateService],
})
export class PersistenceModule {}
