import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

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
