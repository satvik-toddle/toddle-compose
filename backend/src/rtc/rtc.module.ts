import { Module } from "@nestjs/common";
import { RtcTokenService } from "./rtc-token.service";
import { RtcInternalClient } from "./rtc-internal.client";

// KeysService is provided globally (KeysModule is @Global), so RtcTokenService can
// inject it without importing KeysModule here.
@Module({
  providers: [RtcTokenService, RtcInternalClient],
  exports: [RtcTokenService, RtcInternalClient],
})
export class RtcModule {}
