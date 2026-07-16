import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "../config/env";
import { PrismaModule } from "../prisma/prisma.module";
import { DocRepository } from "../persistence/doc-repository.service";
import { BackendInternalClient } from "../persistence/backend-internal.client";
import { IndexerService } from "./indexer.service";

// Standalone module for the detached indexer process. Deliberately does NOT import the WS
// server's AppModule (no Yjs server, no HTTP, no compaction) — only the pieces the worker
// needs: the rtc DB client, the doc repository, the backend push client, and the loop.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    PrismaModule,
  ],
  providers: [DocRepository, BackendInternalClient, IndexerService],
})
export class IndexerAppModule {}
