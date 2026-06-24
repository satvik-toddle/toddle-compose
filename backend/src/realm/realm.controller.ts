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
import { RealmService } from "./realm.service";
import {
  AddRealmUserDto,
  PaginationDto,
  UpdateRealmSettingsDto,
  UpdateRealmUserDto,
} from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("realm")
export class RealmController {
  constructor(private readonly realm: RealmService) {}

  @Get()
  info(@CurrentUser() user: AuthUser) {
    return this.realm.info(user.id);
  }

  @Patch()
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateRealmSettingsDto
  ) {
    return this.realm.updateSettings(user.id, dto.allowedEmailDomains);
  }

  @Get("users")
  listUsers(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.realm.listUsers(user.id, page.skip, page.take);
  }

  @Post("users")
  addUser(@CurrentUser() user: AuthUser, @Body() dto: AddRealmUserDto) {
    return this.realm.addUser(user.id, dto.email, dto.role);
  }

  @Patch("users/:userId")
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param("userId") targetUserId: string,
    @Body() dto: UpdateRealmUserDto
  ) {
    return this.realm.updateUser(user.id, targetUserId, dto.role);
  }

  @Delete("users/:userId")
  removeUser(
    @CurrentUser() user: AuthUser,
    @Param("userId") targetUserId: string
  ) {
    return this.realm.removeUser(user.id, targetUserId);
  }
}
