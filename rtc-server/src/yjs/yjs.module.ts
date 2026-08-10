import { Module } from "@nestjs/common";
import { TokensModule } from "../tokens/tokens.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { YjsServerService } from "./yjs-server.service";
import { DocKickService } from "./doc-kick.service";

@Module({
  imports: [TokensModule, PersistenceModule],
  providers: [YjsServerService, DocKickService],
  exports: [DocKickService],
})
export class YjsModule {}
