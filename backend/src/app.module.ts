import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { KeysModule } from "./keys/keys.module";
import { AuthModule } from "./auth/auth.module";
import { RealmModule } from "./realm/realm.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { FoldersModule } from "./folders/folders.module";
import { DocumentsModule } from "./documents/documents.module";
import { StorageModule } from "./storage/storage.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    // Rate limiting (applied per-route via ThrottlerGuard + @Throttle — see the
    // auth controller). Disabled under e2e tests so they can hammer the API.
    // NOTE: in-memory storage — limits are per-instance, so N replicas multiply
    // them by N. Use a Redis-backed throttler storage when scaling out.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
