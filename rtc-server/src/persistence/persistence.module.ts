import { Module } from "@nestjs/common";
import { CompactionModule } from "../compaction/compaction.module";
import { DocStateService } from "./doc-state.service";
import { CodaExtractService } from "./coda-extract.service";

@Module({
  imports: [CompactionModule],
  providers: [DocStateService, CodaExtractService],
  exports: [DocStateService, CodaExtractService],
})
export class PersistenceModule {}
