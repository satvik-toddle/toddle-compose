import { ForbiddenException, Injectable } from "@nestjs/common";
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
    const wsRole = await this.authz.effectiveWorkspaceRole(user.id, workspaceId);
    // Grant-only guests hold no workspace role but earn implicit entry scoped to their granted docs.
    let role: WorkspaceRole = wsRole ?? "READ";
    let guest = false;
    if (wsRole === null) {
      if (!(await this.authz.hasDocGrantInWorkspace(user.id, workspaceId))) {
        throw new ForbiddenException("requires workspace role READ or higher");
      }
      guest = true;
    }
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
