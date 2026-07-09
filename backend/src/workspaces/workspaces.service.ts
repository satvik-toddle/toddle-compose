import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, RealmRole, Visibility, WorkspaceRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "../realm/active-realm.service";
import { AuthzService } from "../realm/authz.service";
import { trace } from "../tracing/trace";

const USER_SELECT = { id: true, email: true, name: true, color: true } as const;

type WorkspacePatch = {
  name?: string;
  visibility?: Visibility;
  defaultRole?: WorkspaceRole;
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realm: ActiveRealmService,
    private readonly authz: AuthzService
  ) {}

  // Realm admins see all workspaces in the realm; everyone else sees only their memberships.
  // Per-page doc grants do NOT surface the workspace here — grantees reach shared docs via
  // "Shared with me", and get() still allows guest entry to the workspace shell.
  async list(userId: string, skip = 0, take = 50) {
    const realmRole = await this.authz.realmRole(userId);

    if (realmRole === "OWNER" || realmRole === "MAINTAINER") {
      const workspaces = await this.prisma.workspace.findMany({
        where: { realmId: this.realm.id },
        orderBy: { createdAt: "asc" },
        skip,
        take,
      });
      return workspaces.map((w) => ({
        ...w,
        role: "ADMIN" as WorkspaceRole,
        guest: false,
      }));
    }

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { realmId: this.realm.id } },
      include: { workspace: true },
      orderBy: { workspace: { createdAt: "asc" } },
      skip,
      take,
    });
    return memberships.map((m) => ({ ...m.workspace, role: m.role, guest: false }));
  }

  /** Create a workspace; requires realm MAINTAINER+. Creator becomes workspace ADMIN. */
  async create(userId: string, patch: WorkspacePatch) {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    return this.prisma.workspace.create({
      data: {
        realmId: this.realm.id,
        name: patch.name!,
        visibility: patch.visibility,
        defaultRole: patch.defaultRole,
        members: { create: { userId, role: "ADMIN" } },
      },
    });
  }

  async get(userId: string, workspaceId: string) {
    return trace("workspaces.get", async () => {
      const { role, isGuest } = await this.authz.requireWorkspaceAccess(userId, workspaceId);
      const ws = await this.authz.getWorkspaceInRealm(workspaceId);
      // Grant-only guest: a per-page grant earns read-only entry to the workspace shell.
      if (isGuest) return { ...ws, role: "READ" as WorkspaceRole, guest: true };
      return { ...ws, role: role as WorkspaceRole, guest: false };
    });
  }

  /** Patch name / visibility / defaultRole; requires workspace ADMIN. */
  async update(userId: string, workspaceId: string, patch: WorkspacePatch) {
    await this.authz.requireWorkspaceRole(userId, workspaceId, "ADMIN");
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: patch.name,
        visibility: patch.visibility,
        defaultRole: patch.defaultRole,
      },
    });
  }

  async remove(userId: string, workspaceId: string) {
    await this.authz.requireWorkspaceRole(userId, workspaceId, "ADMIN");
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
    return { ok: true as const };
  }

  async listUsers(userId: string, workspaceId: string, skip = 0, take = 50) {
    await this.authz.requireWorkspaceRole(userId, workspaceId, "READ");
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    });
    // Attach each member's realm role so the UI can gate admin-only controls.
    const realmRoles = await this.prisma.realmMember.findMany({
      where: { realmId: this.realm.id, userId: { in: members.map((m) => m.userId) } },
      select: { userId: true, role: true },
    });
    const roleByUser = new Map(realmRoles.map((r) => [r.userId, r.role]));
    return members.map((m) => ({ ...m, realmRole: roleByUser.get(m.userId) ?? null }));
  }

  // Adds an existing user (workspace ADMIN); also ensures realm membership (tenant boundary).
  async addUser(
    actorId: string,
    workspaceId: string,
    email: string,
    role: WorkspaceRole
  ) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException("no user with that email — they must register first");
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing) throw new ConflictException("user is already a workspace member");

    const [actorRealmRole, targetRealmRole] = await Promise.all([
      this.authz.realmRole(actorId),
      this.authz.realmRole(user.id),
    ]);
    this.assertCanManageMember({
      actorId,
      targetUserId: user.id,
      actorRealmRole,
      targetRealmRole,
      currentWsRole: null,
      nextWsRole: role,
    });

    return this.prisma.$transaction(async (tx) => {
      await this.ensureRealmMember(tx, user.id);
      return tx.workspaceMember.create({
        data: { workspaceId, userId: user.id, role },
        include: { user: { select: USER_SELECT } },
      });
    });
  }

  // ----------------------------------------------------------- join lifecycle

  // Realm workspaces the caller isn't in (metadata only): PRIVATE can be requested, PUBLIC self-joined.
  // Open to any authenticated user so new sign-ups can find a workspace without a realm-admin step;
  // joining/approval is what actually grants realm membership (see ensureRealmMember).
  async discoverable(userId: string, skip = 0, take = 50) {
    return this.prisma.workspace.findMany({
      where: {
        realmId: this.realm.id,
        members: { none: { userId } },
      },
      select: { id: true, name: true, visibility: true, defaultRole: true },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    });
  }

  /** Self-join a PUBLIC workspace as its defaultRole. PRIVATE → must request instead. */
  async join(userId: string, workspaceId: string) {
    const ws = await this.authz.getWorkspaceInRealm(workspaceId);
    if (ws.visibility !== "PUBLIC") {
      throw new ForbiddenException("private workspace — request to join instead");
    }
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (existing) throw new ConflictException("already a workspace member");

    return this.prisma.$transaction(async (tx) => {
      await this.ensureRealmMember(tx, userId);
      return tx.workspaceMember.create({
        data: { workspaceId, userId, role: ws.defaultRole },
        include: { user: { select: USER_SELECT } },
      });
    });
  }

  /** Request to join a PRIVATE workspace (PENDING until an admin decides). */
  async requestJoin(userId: string, workspaceId: string, requestedRole?: WorkspaceRole) {
    const ws = await this.authz.getWorkspaceInRealm(workspaceId);
    if (ws.visibility === "PUBLIC") {
      throw new BadRequestException("public workspace — join directly");
    }
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (member) throw new ConflictException("already a workspace member");

    const pending = await this.prisma.joinRequest.findFirst({
      where: { workspaceId, userId, state: "PENDING" },
    });
    if (pending) throw new ConflictException("a join request is already pending");

    return this.prisma.joinRequest.create({
      data: { workspaceId, userId, requestedRole: requestedRole ?? ws.defaultRole },
    });
  }

  // The caller's own join requests in this realm (any state) — drives the /access status poll.
  async myRequests(userId: string) {
    return this.prisma.joinRequest.findMany({
      where: { userId, workspace: { realmId: this.realm.id } },
      include: {
        workspace: { select: { id: true, name: true, visibility: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** List join requests (default PENDING). Requires workspace ADMIN. */
  async listRequests(
    actorId: string,
    workspaceId: string,
    state: "PENDING" | "APPROVED" | "REJECTED" = "PENDING"
  ) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");
    return this.prisma.joinRequest.findMany({
      where: { workspaceId, state },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });
  }

  // Realm-wide inbox: realm admins see every request; workspace ADMINs see only theirs ([] if none).
  async listAllRequests(
    userId: string,
    state: "PENDING" | "APPROVED" | "REJECTED" = "PENDING",
    workspaceId?: string
  ) {
    const realmRole = await this.authz.realmRole(userId);
    const isRealmAdmin = realmRole === "OWNER" || realmRole === "MAINTAINER";
    return this.prisma.joinRequest.findMany({
      where: {
        state,
        ...(workspaceId ? { workspaceId } : {}),
        workspace: isRealmAdmin
          ? { realmId: this.realm.id }
          : { realmId: this.realm.id, members: { some: { userId, role: "ADMIN" } } },
      },
      include: {
        user: { select: USER_SELECT },
        workspace: { select: { id: true, name: true, visibility: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Approve a PENDING request → adds the member (requires workspace ADMIN). */
  async approveRequest(
    actorId: string,
    workspaceId: string,
    requestId: string,
    role?: WorkspaceRole
  ) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");
    const req = await this.getPendingRequestOrThrow(workspaceId, requestId);
    const grantedRole = role ?? req.requestedRole;

    return this.prisma.$transaction(async (tx) => {
      await this.ensureRealmMember(tx, req.userId);
      const member = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: req.userId } },
        update: { role: grantedRole },
        create: { workspaceId, userId: req.userId, role: grantedRole },
        include: { user: { select: USER_SELECT } },
      });
      await tx.joinRequest.update({
        where: { id: requestId },
        data: { state: "APPROVED", decidedById: actorId, decidedAt: new Date() },
      });
      return member;
    });
  }

  /** Reject a PENDING request (requires workspace ADMIN). */
  async rejectRequest(actorId: string, workspaceId: string, requestId: string) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");
    await this.getPendingRequestOrThrow(workspaceId, requestId);
    return this.prisma.joinRequest.update({
      where: { id: requestId },
      data: { state: "REJECTED", decidedById: actorId, decidedAt: new Date() },
    });
  }

  async updateUser(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    role: WorkspaceRole
  ) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");

    // Resolve realm roles up front (independent reads) so the gate is consistent with the tx body.
    const [actorRealmRole, targetRealmRole] = await Promise.all([
      this.authz.realmRole(actorId),
      this.authz.realmRole(targetUserId),
    ]);

    // SERIALIZABLE so concurrent demotions can't both pass the last-admin check.
    return this.prisma.$transaction(
      async (tx) => {
        const member = await this.getMemberOrThrow(workspaceId, targetUserId, tx);

        this.assertCanManageMember({
          actorId,
          targetUserId,
          actorRealmRole,
          targetRealmRole,
          currentWsRole: member.role,
          nextWsRole: role,
        });

        if (member.role === "ADMIN" && role !== "ADMIN") {
          await this.assertNotLastAdmin(workspaceId, tx);
        }

        return tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
          data: { role },
          include: { user: { select: USER_SELECT } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async removeUser(actorId: string, workspaceId: string, targetUserId: string) {
    await this.authz.requireWorkspaceRole(actorId, workspaceId, "ADMIN");

    const [actorRealmRole, targetRealmRole] = await Promise.all([
      this.authz.realmRole(actorId),
      this.authz.realmRole(targetUserId),
    ]);

    // Same race guard as updateUser: count + delete must be atomic.
    await this.prisma.$transaction(
      async (tx) => {
        const member = await this.getMemberOrThrow(workspaceId, targetUserId, tx);

        this.assertCanManageMember({
          actorId,
          targetUserId,
          actorRealmRole,
          targetRealmRole,
          currentWsRole: member.role,
          nextWsRole: null,
        });

        if (member.role === "ADMIN") await this.assertNotLastAdmin(workspaceId, tx);

        await tx.workspaceMember.delete({
          where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return { ok: true as const };
  }

  private async getMemberOrThrow(
    workspaceId: string,
    userId: string,
    db: Prisma.TransactionClient = this.prisma
  ) {
    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw new NotFoundException("user is not a workspace member");
    return member;
  }

  private async getPendingRequestOrThrow(workspaceId: string, requestId: string) {
    const req = await this.prisma.joinRequest.findFirst({
      where: { id: requestId, workspaceId },
    });
    if (!req) throw new NotFoundException("join request not found");
    if (req.state !== "PENDING") {
      throw new ConflictException(`request already ${req.state.toLowerCase()}`);
    }
    return req;
  }

  /** Tenant integrity: ensure realm membership without downgrading an existing role. */
  private async ensureRealmMember(tx: Prisma.TransactionClient, userId: string) {
    await tx.realmMember.upsert({
      where: { realmId_userId: { realmId: this.realm.id, userId } },
      update: {},
      create: { realmId: this.realm.id, userId, role: "MEMBER" },
    });
  }

  // Membership-management gate shared by addUser/updateUser/removeUser (rules 1-3).
  // Realm OWNER is untouchable; MAINTAINER only by the OWNER; workspace-ADMIN
  // grant/demote/remove is realm-admin-controlled (self-changes are exempt).
  private assertCanManageMember(params: {
    actorId: string;
    targetUserId: string;
    actorRealmRole: RealmRole | null;
    targetRealmRole: RealmRole | null;
    currentWsRole: WorkspaceRole | null;
    nextWsRole: WorkspaceRole | null;
  }) {
    const { actorId, targetUserId, actorRealmRole, targetRealmRole, currentWsRole, nextWsRole } =
      params;
    const isRealmAdmin = (r: RealmRole | null) => r === "OWNER" || r === "MAINTAINER";

    // Rule 1: the realm owner's membership is off-limits to everyone.
    if (targetRealmRole === "OWNER") {
      throw new ForbiddenException("cannot modify the realm owner's membership");
    }
    // Rule 2: a realm maintainer may only be managed by the realm owner.
    if (targetRealmRole === "MAINTAINER" && actorRealmRole !== "OWNER") {
      throw new ForbiddenException("only the realm owner may modify a realm maintainer's membership");
    }
    // Rule 3: granting/demoting/removing workspace ADMIN is realm-admin-controlled; self-changes are exempt.
    const isSelf = actorId === targetUserId;
    if (!isSelf && !isRealmAdmin(actorRealmRole)) {
      const touchesAdmin = nextWsRole === "ADMIN" || currentWsRole === "ADMIN";
      if (touchesAdmin) {
        throw new ForbiddenException("only a realm admin may manage workspace admins");
      }
    }
  }

  private async assertNotLastAdmin(
    workspaceId: string,
    db: Prisma.TransactionClient = this.prisma
  ) {
    const admins = await db.workspaceMember.count({
      where: { workspaceId, role: "ADMIN" },
    });
    if (admins <= 1) {
      throw new ConflictException("cannot remove the workspace's last admin");
    }
  }
}
