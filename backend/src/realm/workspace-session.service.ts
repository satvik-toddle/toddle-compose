import { Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import type { AuthUser } from "../auth/current-user.decorator";
import { AuthzService } from "./authz.service";

/**
 * "Sign in to" / "sign out of" a workspace. Entering re-mints the access token with
 * the workspace baked in as scope; leaving clears it (realm admins fall back to the
 * realm-wide view). This is NOT re-authentication — identity is unchanged.
 */
@Injectable()
export class WorkspaceSessionService {
  constructor(
    private readonly authz: AuthzService,
    private readonly auth: AuthService
  ) {}

  async enter(user: AuthUser, workspaceId: string) {
    // 404 if the workspace isn't in this realm; 403 if the user has no access.
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
