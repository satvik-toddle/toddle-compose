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
