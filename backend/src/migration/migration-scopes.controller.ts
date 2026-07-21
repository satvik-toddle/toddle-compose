import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { MigrationScopesService } from "./migration-scopes.service";
import {
  CreateMigrationScopeDto,
  ListMigrationScopesDto,
  UpdateMigrationScopeDto,
} from "./dto";

// Destination (MigrationScope) management. Per-workspace endpoints require that
// workspace's ADMIN; the org-wide listing (no workspaceId) requires realm admin.
// Responses carry masked token hints only — token plaintext never leaves the DB.
@UseGuards(JwtAuthGuard)
@Controller("migration-scopes")
export class MigrationScopesController {
  constructor(private readonly scopes: MigrationScopesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListMigrationScopesDto) {
    return this.scopes.list(user.id, q.workspaceId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMigrationScopeDto) {
    return this.scopes.create(user.id, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateMigrationScopeDto,
  ) {
    return this.scopes.update(user.id, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.scopes.remove(user.id, id);
  }
}
