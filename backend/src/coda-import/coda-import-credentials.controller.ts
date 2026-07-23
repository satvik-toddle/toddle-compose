import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { CodaImportCredentialsService } from "./coda-import-credentials.service";
import { CreateCodaImportCredentialDto } from "./dto";

// The global Coda import token pool. Every endpoint is realm-admin gated
// (MAINTAINER+, enforced in the service). Responses carry masked hints only —
// token plaintext never leaves the DB.
@UseGuards(JwtAuthGuard)
@Controller("admin/coda-import/credentials")
export class CodaImportCredentialsController {
  constructor(private readonly credentials: CodaImportCredentialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.credentials.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCodaImportCredentialDto,
  ) {
    return this.credentials.create(user.id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.credentials.remove(user.id, id);
  }
}
