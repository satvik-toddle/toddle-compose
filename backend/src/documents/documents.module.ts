import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { RtcModule } from "../rtc/rtc.module";
import { DocumentsService } from "./documents.service";
import { DocumentCacheService } from "./document-cache.service";
import { DocumentsController } from "./documents.controller";

@Module({
  imports: [AuthModule, RealmModule, RtcModule],
  providers: [DocumentsService, DocumentCacheService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
