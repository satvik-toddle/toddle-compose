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
import { MigrationJobsService } from "./migration-jobs.service";
import { EnqueueMigrationJobDto, ListMigrationJobsDto } from "./dto";

// "Copy to Coda" job lifecycle (Phase 4b): enqueue a run from a destination, then
// list/read/cancel/retry runs. Visibility is workspace-scoped (EDIT+; org-wide only
// via the realm-admin listing) — runs expose destination Coda URLs (P6). Responses
// never carry scope tokens or worker lease internals.
@UseGuards(JwtAuthGuard)
@Controller()
export class MigrationJobsController {
  constructor(private readonly jobs: MigrationJobsService) {}

  @Post("migration-scopes/:scopeId/jobs")
  enqueue(
    @CurrentUser() user: AuthUser,
    @Param("scopeId") scopeId: string,
    @Body() dto: EnqueueMigrationJobDto,
  ) {
    return this.jobs.enqueue(user.id, scopeId, dto);
  }

  @Get("migration-jobs")
  list(@CurrentUser() user: AuthUser, @Query() q: ListMigrationJobsDto) {
    return this.jobs.list(user.id, q.workspaceId);
  }

  @Get("migration-jobs/:jobId")
  get(@CurrentUser() user: AuthUser, @Param("jobId") jobId: string) {
    return this.jobs.get(user.id, jobId);
  }

  @Post("migration-jobs/:jobId/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("jobId") jobId: string) {
    return this.jobs.cancel(user.id, jobId);
  }

  @Post("migration-jobs/:jobId/retry")
  retry(@CurrentUser() user: AuthUser, @Param("jobId") jobId: string) {
    return this.jobs.retry(user.id, jobId);
  }
}
