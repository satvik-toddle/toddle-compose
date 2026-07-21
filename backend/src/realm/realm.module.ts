import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ActiveRealmService } from "./active-realm.service";
import { AuthzService } from "./authz.service";
import { RealmService } from "./realm.service";
import { RealmController } from "./realm.controller";
import { OrgJoinRequestsService } from "./org-join-requests.service";
import { OrgJoinRequestsController } from "./org-join-requests.controller";
import { WorkspaceSessionService } from "./workspace-session.service";
import { WorkspaceSessionController } from "./workspace-session.controller";

@Module({
  imports: [AuthModule],
  providers: [
    ActiveRealmService,
    AuthzService,
    RealmService,
    OrgJoinRequestsService,
    WorkspaceSessionService,
  ],
  controllers: [
    RealmController,
    OrgJoinRequestsController,
    WorkspaceSessionController,
  ],
  // Shared so WorkspacesModule reuses the same authz choke point.
  // RealmService is exported so DocumentsModule can reuse searchDirectory for the doc picker.
  exports: [ActiveRealmService, AuthzService, RealmService],
})
export class RealmModule {}
