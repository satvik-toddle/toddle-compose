import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";
import { ContentBackfillService } from "./content-backfill.service";

@Module({
  imports: [CompactionModule],
  providers: [DocStateService, ContentBackfillService],
  exports: [DocStateService],
})
export class PersistenceModule {}
