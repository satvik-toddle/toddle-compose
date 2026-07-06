import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailerModule } from "../mailer/mailer.module";
import { RealmModule } from "../realm/realm.module";
import { RtcModule } from "../rtc/rtc.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { DocumentsService } from "./documents.service";
import { DocumentPermissionsService } from "./document-permissions.service";
import { DocumentCacheService } from "./document-cache.service";
import { DocumentsController } from "./documents.controller";

@Module({
  imports: [AuthModule, MailerModule, RealmModule, RtcModule, RealtimeModule],
  providers: [DocumentsService, DocumentPermissionsService, DocumentCacheService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
