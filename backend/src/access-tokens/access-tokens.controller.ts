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
import { NoAccessTokenGuard } from "../auth/no-access-token.guard";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { AccessTokensService } from "./access-tokens.service";
import { CreateAccessTokenDto } from "./dto";

@UseGuards(JwtAuthGuard, NoAccessTokenGuard)
@Controller("access-tokens")
export class AccessTokensController {
  constructor(private readonly tokens: AccessTokensService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccessTokenDto) {
    return this.tokens.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user.id);
  }

  @Delete(":id")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tokens.revoke(user.id, id);
  }
}
