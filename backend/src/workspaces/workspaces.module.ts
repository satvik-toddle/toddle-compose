import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { WorkspacesService } from "./workspaces.service";
import { WorkspacesController } from "./workspaces.controller";

@Module({
  imports: [AuthModule, RealmModule],
  providers: [WorkspacesService],
  controllers: [WorkspacesController],
  // Exported so CodaImportModule can create the target workspace at enqueue.
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
