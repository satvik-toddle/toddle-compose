import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { DataModule } from "./persistence/data.module";
import { CompactionModule } from "./compaction/compaction.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { HistoryModule } from "./history/history.module";
import { TokensModule } from "./tokens/tokens.module";
import { YjsModule } from "./yjs/yjs.module";
import { InternalApiModule } from "./internal/internal-api.module";
import { ContentModule } from "./content/content.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env"],
      validate: validateEnv,
    }),
    PrismaModule,
    DataModule,
    CompactionModule,
    PersistenceModule,
    HistoryModule,
    TokensModule,
    YjsModule,
    InternalApiModule,
    ContentModule,
  ],
})
export class AppModule {}
