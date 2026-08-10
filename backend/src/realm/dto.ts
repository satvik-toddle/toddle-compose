import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

// OWNER excluded: the seeded realm owner is never assignable via the API.
const ASSIGNABLE_REALM_ROLES = ["MAINTAINER", "MEMBER"] as const;
type AssignableRealmRole = (typeof ASSIGNABLE_REALM_ROLES)[number];

const JOIN_STATES = ["PENDING", "APPROVED", "REJECTED"] as const;
type JoinStateInput = (typeof JOIN_STATES)[number];

export class AddRealmUserDto {
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_REALM_ROLES)
  role!: AssignableRealmRole;
}

export class UpdateRealmUserDto {
  @IsIn(ASSIGNABLE_REALM_ROLES)
  role!: AssignableRealmRole;
}

export class UpdateRealmSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsBoolean()
  joinRequestsEnabled?: boolean;
}

export class ListOrgJoinRequestsDto {
  @IsOptional()
  @IsIn(JOIN_STATES)
  state?: JoinStateInput;
}

export class SearchRealmUsersDto {
  // Substring matched case-insensitively against realm members' names and emails;
  // omitted/blank → the first `take` members (initial dropdown list).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  // Result cap for the dropdown; defaults to 20 and can only be lowered.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  take?: number;
}

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
