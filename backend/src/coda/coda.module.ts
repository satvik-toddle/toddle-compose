import { Module } from "@nestjs/common";
import { CodaClient } from "./coda.client";
import { CodaRateLimiter } from "./coda-rate-limiter";

// Coda API access for the "Copy to Coda" migration feature. A later migration
// module imports CodaModule and consumes CodaClient. ConfigService is available
// globally (ConfigModule.forRoot({ isGlobal: true })), so no import needed here.
@Module({
  providers: [CodaClient, CodaRateLimiter],
  exports: [CodaClient, CodaRateLimiter],
})
export class CodaModule {}
