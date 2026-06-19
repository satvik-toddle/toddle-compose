import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const SCOPES = ["REALM", "WORKSPACE"] as const;
const PERMISSIONS = ["VIEW", "COMMENT", "EDIT", "ADMIN", "MAINTAINER"] as const;

export class CreateAccessTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(SCOPES)
  scope!: (typeof SCOPES)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  workspaceId?: string;

  @IsIn(PERMISSIONS)
  permission!: (typeof PERMISSIONS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
