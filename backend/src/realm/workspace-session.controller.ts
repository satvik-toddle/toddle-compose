import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { WorkspaceSessionService } from "./workspace-session.service";

export class EnterWorkspaceDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller("auth/workspace")
export class WorkspaceSessionController {
  constructor(private readonly session: WorkspaceSessionService) {}

  /** Enter a workspace → access token scoped to it. */
  @Post("enter")
  enter(@CurrentUser() user: AuthUser, @Body() dto: EnterWorkspaceDto) {
    return this.session.enter(user, dto.workspaceId);
  }

  /** Leave the active workspace → identity-scoped access token. */
  @Post("leave")
  leave(@CurrentUser() user: AuthUser) {
    return this.session.leave(user);
  }
}
