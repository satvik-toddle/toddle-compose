import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { CodaImportJobsService } from "./coda-import-jobs.service";
import { EnqueueCodaImportJobDto } from "./dto";

// "Import from Coda" job API (Phase 6). Every endpoint is realm-admin gated
// (MAINTAINER+, enforced in the service): imports create a new workspace and run
// against the global Coda token pool. Responses never carry tokens or lease state.
@UseGuards(JwtAuthGuard)
@Controller("admin/coda-import")
export class CodaImportJobsController {
  constructor(private readonly jobs: CodaImportJobsService) {}

  @Get("validate")
  validate(
    @CurrentUser() user: AuthUser,
    @Query("url") url: string,
    @Query("credentialId") credentialId: string,
  ) {
    return this.jobs.validate(user.id, url, credentialId);
  }

  @Post("jobs")
  enqueue(@CurrentUser() user: AuthUser, @Body() dto: EnqueueCodaImportJobDto) {
    return this.jobs.enqueue(user.id, dto);
  }

  @Get("jobs")
  list(@CurrentUser() user: AuthUser) {
    return this.jobs.list(user.id);
  }

  @Get("jobs/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.get(user.id, id);
  }

  @Post("jobs/:id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.cancel(user.id, id);
  }
}
