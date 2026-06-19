import { Module } from "@nestjs/common";
import { RealmModule } from "../realm/realm.module";
import { WorkspaceEventsService } from "./realtime.service";
import { WorkspaceStreamGuard } from "./workspace-stream.guard";
import { RealtimeController } from "./realtime.controller";

// RealmModule supplies AuthzService; JwtService and PrismaService are global.
@Module({
  imports: [RealmModule],
  providers: [WorkspaceEventsService, WorkspaceStreamGuard],
  controllers: [RealtimeController],
  exports: [WorkspaceEventsService],
})
export class RealtimeModule {}
