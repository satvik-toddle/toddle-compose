import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

// One Coda API token to attach to a destination (plaintext on the wire only;
// encrypted before it touches the DB and never returned to a client).
export class ScopeTokenInputDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class CreateMigrationScopeDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  // Coda browser URL of the destination root (a whole doc OR a specific page).
  @IsString()
  @MinLength(1)
  codaUrl!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScopeTokenInputDto)
  tokens!: ScopeTokenInputDto[];
}

export class UpdateMigrationScopeDto {
  // Rename the destination.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  // Tokens to add — each re-validated against the scope's resolved doc before persisting.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScopeTokenInputDto)
  addTokens?: ScopeTokenInputDto[];

  // Token row ids to remove from the pool.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeTokenIds?: string[];
}

// GET filter: with workspaceId → that workspace's scopes (requires workspace ADMIN);
// without → org-wide admin-console listing (requires realm admin).
export class ListMigrationScopesDto {
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

// One row of the user-arranged migration plan (§2 preview tree).
export class MigrationPlanItemDto {
  @IsString()
  @MinLength(1)
  sourceDocId!: string;

  // User-arranged parent within this run (D10); null/omitted = the subtree root.
  @IsOptional()
  @IsString()
  plannedParentDocId?: string | null;

  @IsString()
  @MaxLength(1024)
  title!: string;

  // Override/retarget: an in-scope Coda page URL. Omit = create a new page.
  @IsOptional()
  @IsString()
  @MinLength(1)
  destinationUrl?: string;

  // Unchecked rows (include:false) are dropped before enqueue.
  @IsBoolean()
  include!: boolean;
}

// POST /migration-scopes/:scopeId/jobs — the arranged plan snapshot (D10).
export class EnqueueMigrationJobDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MigrationPlanItemDto)
  items!: MigrationPlanItemDto[];

  // The subtree root the copy was initiated from. Optional: falls back to the
  // row whose plannedParentDocId is null.
  @IsOptional()
  @IsString()
  sourceRootDocId?: string;
}

// GET /migration-jobs filter: with workspaceId → that workspace's runs (requires
// workspace EDIT+); without → org-wide admin-console listing (requires realm admin).
export class ListMigrationJobsDto {
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
