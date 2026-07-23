import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./config/env";
import { rateLimit } from "./config/rate-limit";
import { PrismaModule } from "./prisma/prisma.module";
import { KeysModule } from "./keys/keys.module";
import { AuthModule } from "./auth/auth.module";
import { RealmModule } from "./realm/realm.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { FoldersModule } from "./folders/folders.module";
import { DocumentsModule } from "./documents/documents.module";
import { StorageModule } from "./storage/storage.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { MigrationModule } from "./migration/migration.module";
import { CodaImportModule } from "./coda-import/coda-import.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    // In-memory storage: per-instance limits, so N replicas multiply them by N (use Redis-backed storage when scaling out).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: rateLimit.ttlMs, limit: rateLimit.globalLimit }],
      skipIf: () => process.env.NODE_ENV === "test",
    }),
    PrismaModule,
    KeysModule,
    AuthModule,
    RealmModule,
    WorkspacesModule,
    FoldersModule,
    DocumentsModule,
    StorageModule,
    RealtimeModule,
    MigrationModule,
    CodaImportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
