import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { FoldersService } from "./folders.service";
import { FoldersController } from "./folders.controller";
import { FoldersPurgeScheduler } from "./folders-purge.scheduler";

@Module({
  // RealmModule exports AuthzService + ActiveRealmService (the shared authz choke point).
  imports: [AuthModule, RealmModule],
  providers: [FoldersService, FoldersPurgeScheduler],
  controllers: [FoldersController],
  exports: [FoldersService],
})
export class FoldersModule {}
