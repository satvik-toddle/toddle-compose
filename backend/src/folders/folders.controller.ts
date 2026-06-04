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
import { FoldersService } from "./folders.service";
import { CreateFolderDto, MoveFolderDto, UpdateFolderDto } from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() page: PaginationDto,
    @Query("workspaceId") workspaceId?: string
  ) {
    return this.folders.list(user, workspaceId, page.skip, page.take);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFolderDto) {
    return this.folders.create(user, dto);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.folders.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateFolderDto
  ) {
    return this.folders.update(user.id, id, dto);
  }

  @Patch(":id/move")
  move(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MoveFolderDto
  ) {
    return this.folders.move(user.id, id, dto.parentId ?? null);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.folders.remove(user.id, id);
  }
}
