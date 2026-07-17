import { Module } from "@nestjs/common";
import { TokensModule } from "../tokens/tokens.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { ContentController } from "./content.controller";

@Module({
  imports: [TokensModule, PersistenceModule],
  controllers: [ContentController],
})
export class ContentModule {}
