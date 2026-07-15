import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";
import { ContentBackfillService } from "./content-backfill.service";
import { BackendInternalClient } from "./backend-internal.client";

@Module({
  imports: [CompactionModule],
  providers: [DocStateService, ContentBackfillService, BackendInternalClient],
  exports: [DocStateService],
})
export class PersistenceModule {}
