import { Injectable } from "@nestjs/common";
import { WorkspaceRole } from "@app/database";
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
    // Grant-only guests hold no workspace role but earn implicit entry scoped to their granted docs.
    const { role: wsRole, isGuest: guest } = await this.authz.requireWorkspaceAccess(
      user.id,
      workspaceId
    );
    const role: WorkspaceRole = wsRole ?? "READ";
    const token = await this.auth.mintAccessToken(user, {
      activeWorkspaceId: workspaceId,
    });
    return { ...token, workspaceId, role, guest };
  }

  async leave(user: AuthUser) {
    const token = await this.auth.mintAccessToken(user, { activeWorkspaceId: null });
    return { ...token, workspaceId: null };
  }
}
