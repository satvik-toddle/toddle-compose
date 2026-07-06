import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { WORKSPACE_ROLES } from "../workspaces/dto";

const VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
type VisibilityInput = (typeof VISIBILITIES)[number];

const DOCUMENT_TYPES = ["DOC", "SHEET"] as const;
type DocumentTypeInput = (typeof DOCUMENT_TYPES)[number];

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

  // DOC (rich-text, default) or SHEET (data grid); both share the RTC/Yjs stack.
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentTypeInput;

  // Folder of the same workspace; omit for the root.
  @IsOptional()
  @IsString()
  folderId?: string;

  // Nest under an existing document (a subdoc); when set, folderId is ignored.
  @IsOptional()
  @IsString()
  parentId?: string;

  // Defaults to the caller's active workspace from the session.
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
  // Move into a folder; null/omitted → workspace root. Mutually exclusive with parentId (parentId wins).
  @IsOptional()
  @IsString()
  folderId?: string | null;

  // Re-parent under another document; null/omitted → detach.
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class SetVisibilityDto {
  @IsIn(VISIBILITIES)
  visibility!: VisibilityInput;
}

export class ListDocumentsDto {
  // Narrow to a single folder; omit for the whole workspace.
  @IsOptional()
  @IsString()
  folderId?: string;

  // "null" (string) → top-level docs only; a document id → that doc's children; omit → whole workspace.
  @IsOptional()
  @IsString()
  parentId?: string;

  // Defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class ListStarredDocumentsDto {
  // Defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class ListSharedDocumentsDto {
  // Defaults to the caller's active workspace from the session.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

// Per-page grants accept any WorkspaceRole; they only ever elevate (effective = max(ws role, grant)).
type DocPermissionRoleInput = (typeof WORKSPACE_ROLES)[number];

export class AddDocumentPermissionDto {
  // The grantee must already be a registered user (looked up by email; 404 otherwise).
  @IsEmail()
  email!: string;

  @IsIn(WORKSPACE_ROLES)
  role!: DocPermissionRoleInput;
}

export class UpdateDocumentPermissionDto {
  @IsIn(WORKSPACE_ROLES)
  role!: DocPermissionRoleInput;
}
