import { Module } from "@nestjs/common";
import { CompactionService } from "./compaction.service";
import { CompactionScheduler } from "./compaction.scheduler";

@Module({
  providers: [CompactionService, CompactionScheduler],
  exports: [CompactionService],
})
export class CompactionModule {}
