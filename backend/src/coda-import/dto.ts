import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

// A Coda API token to add to the global import pool (plaintext on the wire only;
// encrypted before it touches the DB and never returned to a client).
export class CreateCodaImportCredentialDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

// POST /admin/coda-import/jobs — import a Coda doc (or a single page's subtree) into a
// NEW workspace. The root is re-resolved server-side from this URL (never trusted from
// the client): a doc URL imports the whole doc; a page URL imports that page's
// descendants (the page becomes the workspace folder).
export class EnqueueCodaImportJobDto {
  // Coda browser URL of the doc OR a page within it. A doc URL → whole-doc import; a
  // page URL → that page's subtree (its descendants become the workspace's docs).
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  codaDocUrl!: string;

  // Name for the new workspace the import materializes into.
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  workspaceName!: string;

  // Which stored Coda credential authorizes this import (the only token used).
  @IsString()
  @IsNotEmpty()
  credentialId!: string;
}
