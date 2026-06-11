import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { RtcModule } from "../rtc/rtc.module";
import { DocumentsService } from "./documents.service";
import {
  DocumentsController,
  SheetsController,
} from "./documents.controller";

@Module({
  // RealmModule exports AuthzService + ActiveRealmService (the shared authz choke point).
  // RtcModule exports RtcTokenService (mint) + RtcInternalClient (provisioning).
  imports: [AuthModule, RealmModule, RtcModule],
  providers: [DocumentsService],
  // /documents (DOC) and /sheets (SHEET) — same service, kind-scoped controllers.
  controllers: [DocumentsController, SheetsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
