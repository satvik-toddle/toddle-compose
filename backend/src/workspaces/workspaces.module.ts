import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { WorkspacesService } from "./workspaces.service";
import { WorkspacesController } from "./workspaces.controller";

@Module({
  // RealmModule exports ActiveRealmService + AuthzService (the shared authz choke point).
  imports: [AuthModule, RealmModule],
  providers: [WorkspacesService],
  controllers: [WorkspacesController],
})
export class WorkspacesModule {}
