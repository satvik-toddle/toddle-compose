import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
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
