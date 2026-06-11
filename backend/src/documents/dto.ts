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

  // Note: document kind (DOC vs SHEET) is NOT a body field — it's determined by the
  // endpoint namespace (POST /documents → DOC, POST /sheets → SHEET).

  // Place the new document inside a folder of the same workspace; omit for the root.
  @IsOptional()
  @IsString()
  folderId?: string;

  // Nest the new document under an existing document (a "subdoc") of the same
  // workspace; omit for a top-level document. When set, folderId is ignored.
  @IsOptional()
  @IsString()
  parentId?: string;

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
  // Move into a folder of the same workspace; null/omitted → workspace root.
  // Mutually exclusive with parentId (parentId wins if both are provided).
  @IsOptional()
  @IsString()
  folderId?: string | null;

  // Re-parent under another document (a subdoc) of the same workspace;
  // null/omitted → detach from any parent.
  @IsOptional()
  @IsString()
  parentId?: string | null;
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

  // Narrow to one document's direct subdocs. "null" (string) → top-level docs only
  // (no parent); a document id → that document's children. Omit for the whole workspace.
  @IsOptional()
  @IsString()
  parentId?: string;

  // Target workspace; defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
