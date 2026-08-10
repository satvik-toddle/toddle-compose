import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { RtcModule } from "../rtc/rtc.module";
import { FoldersService } from "./folders.service";
import { FoldersController } from "./folders.controller";
import { FoldersPurgeScheduler } from "./folders-purge.scheduler";

@Module({
  imports: [AuthModule, RealmModule, RtcModule],
  providers: [FoldersService, FoldersPurgeScheduler],
  controllers: [FoldersController],
  exports: [FoldersService],
})
export class FoldersModule {}
