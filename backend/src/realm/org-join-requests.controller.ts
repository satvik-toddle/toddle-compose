import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { OrgJoinRequestsService } from "./org-join-requests.service";
import { ListOrgJoinRequestsDto } from "./dto";

@UseGuards(JwtAuthGuard)
@Controller("realm/join-requests")
export class OrgJoinRequestsController {
  constructor(private readonly service: OrgJoinRequestsService) {}

  @Post()
  requestJoin(@CurrentUser() user: AuthUser) {
    return this.service.requestJoin(user.id);
  }

  // Literal path must precede ":id" so it isn't captured as an id.
  @Get("mine")
  myRequest(@CurrentUser() user: AuthUser) {
    return this.service.myRequest(user.id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() dto: ListOrgJoinRequestsDto) {
    return this.service.list(user.id, dto.state);
  }

  @Post(":id/approve")
  approve(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(":id/reject")
  reject(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.reject(user.id, id);
  }
}
