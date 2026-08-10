import { Module } from "@nestjs/common";
import { VersionsService } from "./versions.service";
import { SessionsService } from "./sessions.service";

@Module({
  providers: [VersionsService, SessionsService],
  exports: [VersionsService, SessionsService],
})
export class HistoryModule {}
