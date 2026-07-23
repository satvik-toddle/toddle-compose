import { Module } from "@nestjs/common";
import { RtcTokenService } from "./rtc-token.service";
import { RtcInternalClient } from "./rtc-internal.client";
import { RtcContentClient } from "./rtc-content.client";

// KeysService is provided globally (@Global), so no KeysModule import needed here.
@Module({
  providers: [RtcTokenService, RtcInternalClient, RtcContentClient],
  exports: [RtcTokenService, RtcInternalClient, RtcContentClient],
})
export class RtcModule {}
