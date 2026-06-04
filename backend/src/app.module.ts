import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { KeysModule } from "./keys/keys.module";
import { AuthModule } from "./auth/auth.module";
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
