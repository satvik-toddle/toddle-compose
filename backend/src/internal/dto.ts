import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

// One document's search projection: its id, extracted plain text, and the rtc snapshot seq
// that text represents (the seq guard, G3). `seq` is optional so the transitional single-doc
// push can omit it (unguarded overwrite) while the worker always sends it.
export class IndexContentItemDto {
  @IsString()
  id!: string;

  @IsString()
  text!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  seq?: number;
}

// Bulk index push from the indexer worker. Capped to keep a single request bounded; the
// worker batches (default 500) well under this.
export class BulkIndexContentDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => IndexContentItemDto)
  items!: IndexContentItemDto[];
}
