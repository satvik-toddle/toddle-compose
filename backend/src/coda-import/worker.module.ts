import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "../config/env";
import { rateLimit } from "../config/rate-limit";
import { PrismaModule } from "../prisma/prisma.module";
import { KeysModule } from "../keys/keys.module";
import { CodaModule } from "../coda/coda.module";
import { RtcModule } from "../rtc/rtc.module";
import { DocumentsModule } from "../documents/documents.module";
import { MigrationModule } from "../migration/migration.module";
import { CodaImportModule } from "./coda-import.module";
import { CodaImportWorkerService } from "./coda-import-worker.service";
import { CodaImportWorkerController } from "./coda-import-worker.controller";

// Root module for the STANDALONE import-worker process (worker-main.ts). This module
// is deliberately NOT imported by AppModule, so the main API never runs the worker —
// the API only enqueues + pings, and this separate process executes the jobs.
//
// It re-declares the same GLOBAL modules AppModule sets up (ConfigModule for env
// validation, ScheduleModule + ThrottlerModule to satisfy the @Interval/@Cron and
// ThrottlerGuard dependencies pulled in transitively via DocumentsModule) plus the
// feature modules that provide the reused services: CodaModule (CodaClient), RtcModule
// (RtcContentClient + RtcInternalClient), DocumentsModule (DocumentsService), and
// CodaImportModule (CodaImportCredentialsService). KeysModule (@Global) is imported so
// RtcTokenService can resolve KeysService. PrismaModule is global.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: rateLimit.ttlMs, limit: rateLimit.globalLimit }],
      skipIf: () => process.env.NODE_ENV === "test",
    }),
    PrismaModule,
    KeysModule,
    CodaModule,
    RtcModule,
    DocumentsModule,
    // Supplies TokenCipher (exported) so the worker can encrypt the reverse-linkage
    // scope token. Already loaded transitively via CodaImportModule; imported here to
    // expose its exports to this module's own providers.
    MigrationModule,
    CodaImportModule,
  ],
  providers: [CodaImportWorkerService],
  controllers: [CodaImportWorkerController],
})
export class WorkerAppModule {}
