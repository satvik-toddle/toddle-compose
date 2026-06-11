import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Pagination for the folders list. Deliberately NOT the shared PaginationDto:
 * the client assembles the folder tree from this flat list, so a small page cap
 * would truncate trees. 2000 covers any realistic workspace in one request.
 */
export class ListFoldersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  take?: number;
}

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  // Nest under an existing folder (same workspace); omit for a top-level folder.
  @IsOptional()
  @IsString()
  parentId?: string;

  // Target workspace; defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;
}

export class MoveFolderDto {
  // null/omitted → move to the top level; otherwise re-parent under this folder.
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
