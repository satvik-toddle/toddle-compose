import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";

@Module({
  imports: [CompactionModule],
  providers: [DocStateService],
  exports: [DocStateService],
})
export class PersistenceModule {}
