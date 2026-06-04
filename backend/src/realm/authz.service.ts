import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RealmRole, WorkspaceRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";

/** Cumulative rank for each ladder; higher number = strictly more capable. */
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

/**
 * Single authorization choke point. Roles are resolved per-request from the DB
 * (never trusted from the JWT) so demotions take effect immediately and there is
 * one source of truth. Realm OWNER/MAINTAINER project to workspace ADMIN on every
 * workspace in the realm (the "overlay").
 */
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

  /** Throws 403 unless the user holds at least `min` in the realm. Returns the actual role. */
  async requireRealmRole(userId: string, min: RealmRole): Promise<RealmRole> {
    const role = await this.realmRole(userId);
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

  /**
   * Effective workspace role = MAX(direct membership, realm overlay).
   * Returns null when the user exists in the realm but has no access to this workspace.
   * 404s when the workspace is not in this realm.
   */
  async effectiveWorkspaceRole(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceRole | null> {
    await this.getWorkspaceInRealm(workspaceId);

    const realmRole = await this.realmRole(userId);
    const overlay: WorkspaceRole | null =
      realmRole === "OWNER" || realmRole === "MAINTAINER" ? "ADMIN" : null;

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    const direct = member?.role ?? null;

    return this.maxWorkspaceRole(overlay, direct);
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
}
