import { Global, Module } from "@nestjs/common";
import { DocRepository } from "./doc-repository.service";
import { LexicalExtractService } from "./lexical-extract.service";

@Global()
@Module({
  providers: [DocRepository, LexicalExtractService],
  exports: [DocRepository, LexicalExtractService],
})
export class DataModule {}
