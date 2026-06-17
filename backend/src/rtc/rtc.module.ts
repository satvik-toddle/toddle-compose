import { Module } from "@nestjs/common";
import { RtcTokenService } from "./rtc-token.service";
import { RtcInternalClient } from "./rtc-internal.client";

// KeysService is provided globally (@Global), so no KeysModule import needed here.
@Module({
  providers: [RtcTokenService, RtcInternalClient],
  exports: [RtcTokenService, RtcInternalClient],
})
export class RtcModule {}
