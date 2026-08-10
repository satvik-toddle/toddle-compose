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

// Not the shared PaginationDto: the client builds the tree from this flat list, so the cap is 2000 to avoid truncating trees.
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

  // Nest under an existing folder; omit for a top-level folder.
  @IsOptional()
  @IsString()
  parentId?: string;

  // Defaults to the caller's active workspace from the session.
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
  // null/omitted → top level; otherwise re-parent under this folder.
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
