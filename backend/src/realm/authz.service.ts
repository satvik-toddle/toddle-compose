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

  // Load a doc and assert the actor can manage its sharing; 404 if missing, 403 if not a manager.
  // Single source for the "load + manage gate" both doc-permissions and share-links need.
  async requireDocManageOrThrow(actorId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, ownerId: true, workspaceId: true },
    });
    if (!doc) throw new NotFoundException("document not found");
    await this.requireDocManage(actorId, doc);
    return doc;
  }

  // Manage gate shared by doc permissions + share links: owner OR effective ws-ADMIN OR doc-ADMIN grantee; else 403.
  async requireDocManage(
    userId: string,
    doc: { id: string; ownerId: string; workspaceId: string }
  ): Promise<void> {
    if (doc.ownerId === userId) return;
    const [wsRole, grant] = await Promise.all([
      this.effectiveWorkspaceRole(userId, doc.workspaceId),
      this.docGrantRole(userId, doc.id),
    ]);
    if (wsRole === "ADMIN" || grant === "ADMIN") return;
    throw new ForbiddenException("requires document ADMIN to manage sharing");
  }

  // Workspace entry gate shared by the list/get/enter read paths: the effective role, or
  // {role:null,isGuest:true} for a grant-only guest; 403 if neither member nor grantee.
  async requireWorkspaceAccess(
    userId: string,
    workspaceId: string
  ): Promise<{ role: WorkspaceRole | null; isGuest: boolean }> {
    const role = await this.effectiveWorkspaceRole(userId, workspaceId);
    if (role !== null) return { role, isGuest: false };
    if (await this.hasDocGrantInWorkspace(userId, workspaceId)) {
      return { role: null, isGuest: true };
    }
    throw new ForbiddenException("requires workspace role READ or higher");
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
