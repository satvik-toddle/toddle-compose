import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "../config/env";
import { PrismaModule } from "../prisma/prisma.module";
import { DocRepository } from "../persistence/doc-repository.service";
import { SearchIndexWriter } from "./search-index-writer";
import { IndexerService } from "./indexer.service";
import { IndexerController } from "./indexer.controller";

// Standalone module for the detached indexer process. Deliberately does NOT import the WS
// server's AppModule — only the rtc DB client (for the queue + yjs_state reads), the backend
// DB writer, the sweep loop, and the /wake route.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    PrismaModule,
  ],
  controllers: [IndexerController],
  providers: [DocRepository, SearchIndexWriter, IndexerService],
})
export class IndexerAppModule {}
