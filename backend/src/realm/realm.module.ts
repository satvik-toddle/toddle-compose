import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ActiveRealmService } from "./active-realm.service";
import { AuthzService } from "./authz.service";
import { RealmService } from "./realm.service";
import { RealmController } from "./realm.controller";
import { WorkspaceSessionService } from "./workspace-session.service";
import { WorkspaceSessionController } from "./workspace-session.controller";

@Module({
  imports: [AuthModule],
  providers: [
    ActiveRealmService,
    AuthzService,
    RealmService,
    WorkspaceSessionService,
  ],
  controllers: [RealmController, WorkspaceSessionController],
  // Shared so WorkspacesModule reuses the same authz choke point.
  exports: [ActiveRealmService, AuthzService],
})
export class RealmModule {}
