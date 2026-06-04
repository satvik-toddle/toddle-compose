import {
  IsIn,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

// Full workspace ladder is assignable (unlike realm OWNER, which is reserved).
const WORKSPACE_ROLES = ["READ", "COMMENT", "EDIT", "ADMIN"] as const;
type WorkspaceRoleInput = (typeof WORKSPACE_ROLES)[number];

const VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
type VisibilityInput = (typeof VISIBILITIES)[number];

const JOIN_STATES = ["PENDING", "APPROVED", "REJECTED"] as const;
type JoinStateInput = (typeof JOIN_STATES)[number];

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: VisibilityInput;

  // Role granted to users who self-join a PUBLIC workspace.
  @IsOptional()
  @IsIn(WORKSPACE_ROLES)
  defaultRole?: WorkspaceRoleInput;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: VisibilityInput;

  @IsOptional()
  @IsIn(WORKSPACE_ROLES)
  defaultRole?: WorkspaceRoleInput;
}

export class CreateJoinRequestDto {
  @IsOptional()
  @IsIn(WORKSPACE_ROLES)
  requestedRole?: WorkspaceRoleInput;
}

export class DecideJoinRequestDto {
  // Role to grant on approval; defaults to the requested role.
  @IsOptional()
  @IsIn(WORKSPACE_ROLES)
  role?: WorkspaceRoleInput;
}

export class ListJoinRequestsDto {
  @IsOptional()
  @IsIn(JOIN_STATES)
  state?: JoinStateInput;

  // Top-level inbox only: narrow to a single workspace.
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class AddWorkspaceUserDto {
  @IsEmail()
  email!: string;

  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRoleInput;
}

export class UpdateWorkspaceUserDto {
  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRoleInput;
}
