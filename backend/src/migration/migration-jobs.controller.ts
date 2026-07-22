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
import {
  EnqueueMigrationJobDto,
  ListMigrationJobsDto,
  ListMigrationMappingsDto,
  ValidateDestinationDto,
} from "./dto";

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

  // Verify a single per-row destination link before enqueue. A bad/out-of-scope URL
  // returns {ok:false, reason} (200), never a 500 — only auth/scope errors throw.
  @Post("migration-scopes/:scopeId/validate-destination")
  validateDestination(
    @CurrentUser() user: AuthUser,
    @Param("scopeId") scopeId: string,
    @Body() dto: ValidateDestinationDto,
  ) {
    return this.jobs.validateDestination(user.id, scopeId, dto.url);
  }

  // Prefill source for the Copy-to-Coda modal — saved mappings for the selected
  // destination, filtered to the docs in view. Same EDIT+ gate as enqueue.
  @Get("migration-scopes/:scopeId/mappings")
  listMappings(
    @CurrentUser() user: AuthUser,
    @Param("scopeId") scopeId: string,
    @Query() q: ListMigrationMappingsDto,
  ) {
    const docIds = (q.docIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return this.jobs.listMappings(user.id, scopeId, docIds);
  }

  // "Open in Coda" — this doc's live Coda destination(s) across its workspace's
  // non-deleted scopes. Same EDIT+ gate as Copy-to-Coda / migrations visibility.
  @Get("documents/:docId/coda-mappings")
  listDocCodaMappings(
    @CurrentUser() user: AuthUser,
    @Param("docId") docId: string,
  ) {
    return this.jobs.listDocCodaMappings(user.id, docId);
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
