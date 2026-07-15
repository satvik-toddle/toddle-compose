import { Module } from "@nestjs/common";
import { InternalController } from "./internal.controller";

// Service-to-service API (rtc-server → backend). PrismaService comes from the global PrismaModule.
@Module({
  controllers: [InternalController],
})
export class InternalApiModule {}
