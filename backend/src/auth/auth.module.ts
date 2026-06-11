import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthTokensGcScheduler } from "./auth-tokens-gc.scheduler";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from "./jwt.constants";
import type { Env } from "../config/env";

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get("JWT_USER_SECRET", { infer: true }),
        // Every token we mint carries pinned iss/aud (verified by JwtAuthGuard).
        signOptions: {
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  providers: [AuthService, JwtAuthGuard, AuthTokensGcScheduler],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
