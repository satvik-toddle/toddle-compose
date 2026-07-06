import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

// OWNER excluded: the seeded realm owner is never assignable via the API.
const ASSIGNABLE_REALM_ROLES = ["MAINTAINER", "MEMBER"] as const;
type AssignableRealmRole = (typeof ASSIGNABLE_REALM_ROLES)[number];

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
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  allowedEmailDomains!: string[];
}

export class SearchRealmUsersDto {
  // Substring matched case-insensitively against realm members' names and emails.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

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
