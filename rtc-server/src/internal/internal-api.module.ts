import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { HistoryModule } from "../history/history.module";
import { CompactionModule } from "../compaction/compaction.module";
import { InternalController, HealthController } from "./internal.controller";
import { InternalTokenGuard } from "./internal-token.guard";

@Module({
  imports: [PersistenceModule, HistoryModule, CompactionModule],
  controllers: [HealthController, InternalController],
  providers: [InternalTokenGuard],
})
export class InternalApiModule {}
