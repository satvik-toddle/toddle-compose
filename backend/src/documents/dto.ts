import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { WORKSPACE_ROLES } from "../workspaces/dto";

const DOCUMENT_TYPES = ["DOC", "SHEET", "WHITEBOARD"] as const;
export type DocumentTypeInput = (typeof DOCUMENT_TYPES)[number];

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

  // DOC (rich-text, default), SHEET (data grid), or WHITEBOARD (canvas); all share the RTC/Yjs stack.
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

// PATCH /documents/:id — partial metadata edit. Every field optional so a caller can
// patch title, fullWidth, or both.
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  fullWidth?: boolean;
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

export class SearchDocumentsDto {
  // Omit for a global search across every workspace the caller can access.
  @IsOptional()
  @IsString()
  workspaceId?: string;

  // Search term matched against titles and content; trimmed at the edge and required non-empty.
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  // Opaque keyset cursor from a previous page's nextCursor; omitted for the first page.
  @IsOptional()
  @IsString()
  cursor?: string;
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

// Share links never confer ADMIN — role is capped at EDIT here, at the API edge.
const SHARE_LINK_ROLES = ["READ", "COMMENT", "EDIT"] as const;
type ShareLinkRoleInput = (typeof SHARE_LINK_ROLES)[number];

const SHARE_LINK_SCOPES = ["REALM", "ANYONE"] as const;
type ShareLinkScopeInput = (typeof SHARE_LINK_SCOPES)[number];

export class UpsertShareLinkDto {
  @IsIn(SHARE_LINK_ROLES)
  role!: ShareLinkRoleInput;

  // REALM → any logged-in realm member with the link; ANYONE → works logged-out.
  @IsIn(SHARE_LINK_SCOPES)
  scope!: ShareLinkScopeInput;
}
