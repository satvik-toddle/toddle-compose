import { Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import type { AuthUser } from "../auth/current-user.decorator";
import { AuthzService } from "./authz.service";

// Re-mints the access token with workspace scope (enter) or clears it (leave); identity is unchanged.
@Injectable()
export class WorkspaceSessionService {
  constructor(
    private readonly authz: AuthzService,
    private readonly auth: AuthService
  ) {}

  async enter(user: AuthUser, workspaceId: string) {
    const role = await this.authz.requireWorkspaceRole(user.id, workspaceId, "READ");
    const token = await this.auth.mintAccessToken(user, {
      activeWorkspaceId: workspaceId,
    });
    return { ...token, workspaceId, role };
  }

  async leave(user: AuthUser) {
    const token = await this.auth.mintAccessToken(user, { activeWorkspaceId: null });
    return { ...token, workspaceId: null };
  }
}
