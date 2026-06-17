import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { RtcModule } from "../rtc/rtc.module";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";

@Module({
  imports: [AuthModule, RealmModule, RtcModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
