import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
type VisibilityInput = (typeof VISIBILITIES)[number];

export class CreateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  // Place the new document inside a folder of the same workspace; omit for the root.
  @IsOptional()
  @IsString()
  folderId?: string;

  // Target workspace; defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class RenameDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}

export class MoveDocumentDto {
  // null/omitted → move to the root; otherwise move into this (owned) folder.
  @IsOptional()
  @IsString()
  folderId?: string | null;
}

export class SetVisibilityDto {
  @IsIn(VISIBILITIES)
  visibility!: VisibilityInput;
}

export class ListDocumentsDto {
  // Narrow the listing to a single folder; omit for the whole workspace.
  @IsOptional()
  @IsString()
  folderId?: string;

  // Target workspace; defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
