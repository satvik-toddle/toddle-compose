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
import { PersonalAccessTokensService } from "./personal-access-tokens.service";
import { CreatePersonalAccessTokenDto } from "./dto";

@UseGuards(JwtAuthGuard, NoAccessTokenGuard)
@Controller("personal-access-tokens")
export class PersonalAccessTokensController {
  constructor(private readonly tokens: PersonalAccessTokensService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePersonalAccessTokenDto) {
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
