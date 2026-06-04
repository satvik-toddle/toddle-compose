import { Global, Module } from "@nestjs/common";
import { KeysService } from "./keys.service";
import { WellKnownController } from "./well-known.controller";

@Global()
@Module({
  providers: [KeysService],
  controllers: [WellKnownController],
  exports: [KeysService],
})
export class KeysModule {}
