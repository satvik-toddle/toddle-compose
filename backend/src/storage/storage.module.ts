import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import type { Env } from "../config/env";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage";
import { LocalObjectStorage } from "./local-object-storage";
import { S3ObjectStorage } from "./s3-object-storage";
import { UploadsController } from "./uploads.controller";

/**
 * Wires the configured ObjectStorage provider behind the OBJECT_STORAGE token.
 * The driver is chosen once, from STORAGE_DRIVER, at startup — consumers inject
 * the interface and never know which backend they got.
 */
@Module({
  imports: [AuthModule], // provides JwtAuthGuard for the upload route
  controllers: [UploadsController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ObjectStorage =>
        config.get("STORAGE_DRIVER", { infer: true }) === "s3"
          ? new S3ObjectStorage(config)
          : new LocalObjectStorage(config),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
