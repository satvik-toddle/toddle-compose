import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RealmRole, WorkspaceRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";

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

    const overlay: WorkspaceRole | null =
      realmRole === "OWNER" || realmRole === "MAINTAINER" ? "ADMIN" : null;
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

  maxWorkspaceRole(
    a: WorkspaceRole | null,
    b: WorkspaceRole | null
  ): WorkspaceRole | null {
    if (a === null) return b;
    if (b === null) return a;
    return WS_ORDER[a] >= WS_ORDER[b] ? a : b;
  }

  // Per-page grant for this user on this exact document (never cascades to sub-pages); null if none.
  async docGrantRole(
    userId: string,
    documentId: string
  ): Promise<WorkspaceRole | null> {
    const grant = await this.prisma.documentPermission.findUnique({
      where: { userId_documentId: { userId, documentId } },
    });
    return grant?.role ?? null;
  }

  // True if `role` (nullable) ranks at or above `min` on the workspace ladder.
  meetsWorkspaceRole(role: WorkspaceRole | null, min: WorkspaceRole): boolean {
    return role !== null && WS_ORDER[role] >= WS_ORDER[min];
  }

  // Whether the user holds any per-page grant on a document in this workspace (drives guest entry).
  async hasDocGrantInWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<boolean> {
    const grant = await this.prisma.documentPermission.findFirst({
      where: { userId, document: { workspaceId } },
      select: { documentId: true },
    });
    return grant !== null;
  }
}
