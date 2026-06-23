import { Type } from "class-transformer";
import { IsEmail, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

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
