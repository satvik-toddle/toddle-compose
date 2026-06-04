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
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { PaginationDto } from "../realm/dto";
import { WorkspacesService } from "./workspaces.service";
import {
  AddWorkspaceUserDto,
  CreateJoinRequestDto,
  CreateWorkspaceDto,
  DecideJoinRequestDto,
  ListJoinRequestsDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceUserDto,
} from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.workspaces.list(user.id, page.skip, page.take);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto);
  }

  // Literal paths must precede ":id" so they aren't captured as an id.
  @Get("discoverable")
  discoverable(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.workspaces.discoverable(user.id, page.skip, page.take);
  }

  /** Realm-wide join-request inbox (realm admins see all). */
  @Get("join-requests")
  allRequests(@CurrentUser() user: AuthUser, @Query() q: ListJoinRequestsDto) {
    return this.workspaces.listAllRequests(user.id, q.state, q.workspaceId);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateWorkspaceDto
  ) {
    return this.workspaces.update(user.id, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.remove(user.id, id);
  }

  // ---- join lifecycle ----

  /** Self-join a PUBLIC workspace. */
  @Post(":id/join")
  join(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.join(user.id, id);
  }

  /** Request to join a PRIVATE workspace. */
  @Post(":id/requests")
  requestJoin(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateJoinRequestDto
  ) {
    return this.workspaces.requestJoin(user.id, id, dto.requestedRole);
  }

  /** List a single workspace's join requests (admins). */
  @Get(":id/requests")
  listRequests(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query() q: ListJoinRequestsDto
  ) {
    return this.workspaces.listRequests(user.id, id, q.state);
  }

  @Post(":id/requests/:requestId/approve")
  approveRequest(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
    @Body() dto: DecideJoinRequestDto
  ) {
    return this.workspaces.approveRequest(user.id, id, requestId, dto.role);
  }

  @Post(":id/requests/:requestId/reject")
  rejectRequest(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string
  ) {
    return this.workspaces.rejectRequest(user.id, id, requestId);
  }

  @Get(":id/users")
  listUsers(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query() page: PaginationDto
  ) {
    return this.workspaces.listUsers(user.id, id, page.skip, page.take);
  }

  @Post(":id/users")
  addUser(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AddWorkspaceUserDto
  ) {
    return this.workspaces.addUser(user.id, id, dto.email, dto.role);
  }

  @Patch(":id/users/:userId")
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
    @Body() dto: UpdateWorkspaceUserDto
  ) {
    return this.workspaces.updateUser(user.id, id, targetUserId, dto.role);
  }

  @Delete(":id/users/:userId")
  removeUser(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") targetUserId: string
  ) {
    return this.workspaces.removeUser(user.id, id, targetUserId);
  }
}
