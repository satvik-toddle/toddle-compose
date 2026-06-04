import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { KeysModule } from "./keys/keys.module";
import { AuthModule } from "./auth/auth.module";
import { RealmModule } from "./realm/realm.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    PrismaModule,
    KeysModule,
    AuthModule,
    RealmModule,
    WorkspacesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
