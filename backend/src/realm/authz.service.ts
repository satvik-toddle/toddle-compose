import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RealmRole, WorkspaceRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";
import { currentTokenAuth } from "../auth/request-context";
import { permissionToWorkspaceRole } from "../auth/access-token.util";

// Rank per ladder; higher = more capable.
const REALM_ORDER: Record<RealmRole, number> = {
  MEMBER: 0,
  MAINTAINER: 1,
  OWNER: 2,
};
const WS_ORDER: Record<WorkspaceRole, number> = {
  READ: 0,
  COMMENT: 1,
  EDIT: 2,
  ADMIN: 3,
};

// Authz choke point: roles resolved per-request from the DB (not the JWT) so demotions take effect immediately. Realm OWNER/MAINTAINER overlay as workspace ADMIN.
@Injectable()
export class AuthzService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realm: ActiveRealmService
  ) {}

  async realmRole(userId: string): Promise<RealmRole | null> {
    const member = await this.prisma.realmMember.findUnique({
      where: { realmId_userId: { realmId: this.realm.id, userId } },
    });
    return member?.role ?? null;
  }

  async requireRealmRole(userId: string, min: RealmRole): Promise<RealmRole> {
    const role = this.capRealmRole(await this.realmRole(userId));
    if (role === null || REALM_ORDER[role] < REALM_ORDER[min]) {
      throw new ForbiddenException(`requires realm role ${min} or higher`);
    }
    return role;
  }

  /** Loads a workspace scoped to the active realm; 404 if absent (no cross-realm leak). */
  async getWorkspaceInRealm(workspaceId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, realmId: this.realm.id },
    });
    if (!ws) throw new NotFoundException("workspace not found");
    return ws;
  }

  // Effective role = MAX(direct membership, realm overlay); null if no access, 404 if workspace not in realm.
  async effectiveWorkspaceRole(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceRole | null> {
    // These three reads are independent — they share only userId/workspaceId/realm.id and
    // none consumes another's result. Run them together so the role check costs one DB
    // round trip instead of three (the dominant fixed cost on every authed request).
    const [, realmRole, member] = await Promise.all([
      this.getWorkspaceInRealm(workspaceId), // 404s if the workspace isn't in this realm
      this.realmRole(userId),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      }),
    ]);

    const token = currentTokenAuth();
    if (token && token.scope === "WORKSPACE" && token.workspaceId !== workspaceId) {
      return null;
    }

    const overlay: WorkspaceRole | null =
      realmRole === "OWNER" || realmRole === "MAINTAINER" ? "ADMIN" : null;
    const direct = member?.role ?? null;

    let effective = this.maxWorkspaceRole(overlay, direct);
    if (token) {
      effective = this.minWorkspaceRole(
        effective,
        permissionToWorkspaceRole(token.permission)
      );
    }
    return effective;
  }

  assertWorkspaceInScope(workspaceId: string): void {
    const token = currentTokenAuth();
    if (token && token.scope === "WORKSPACE" && token.workspaceId !== workspaceId) {
      throw new NotFoundException("not found");
    }
  }

  tokenAllowsWorkspaceRole(min: WorkspaceRole): boolean {
    const token = currentTokenAuth();
    if (!token) return true;
    return WS_ORDER[permissionToWorkspaceRole(token.permission)] >= WS_ORDER[min];
  }

  /** Throws 403 unless the user holds at least `min` in the workspace. Returns the actual role. */
  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    min: WorkspaceRole
  ): Promise<WorkspaceRole> {
    const role = await this.effectiveWorkspaceRole(userId, workspaceId);
    if (role === null || WS_ORDER[role] < WS_ORDER[min]) {
      throw new ForbiddenException(`requires workspace role ${min} or higher`);
    }
    return role;
  }

  private maxWorkspaceRole(
    a: WorkspaceRole | null,
    b: WorkspaceRole | null
  ): WorkspaceRole | null {
    if (a === null) return b;
    if (b === null) return a;
    return WS_ORDER[a] >= WS_ORDER[b] ? a : b;
  }

  private minWorkspaceRole(
    a: WorkspaceRole | null,
    b: WorkspaceRole | null
  ): WorkspaceRole | null {
    if (a === null || b === null) return null;
    return WS_ORDER[a] <= WS_ORDER[b] ? a : b;
  }

  private capRealmRole(live: RealmRole | null): RealmRole | null {
    const token = currentTokenAuth();
    if (!token || live === null) return live;
    if (token.scope === "WORKSPACE") return null;
    const ceiling: RealmRole =
      token.permission === "MAINTAINER" ? "MAINTAINER" : "MEMBER";
    return REALM_ORDER[live] <= REALM_ORDER[ceiling] ? live : ceiling;
  }
}
