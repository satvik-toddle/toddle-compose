import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RealmRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";
import { AuthzService } from "./authz.service";

// Never expose passwordHash.
const USER_SELECT = { id: true, email: true, name: true, color: true } as const;

@Injectable()
export class RealmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realm: ActiveRealmService,
    private readonly authz: AuthzService
  ) {}

  async info(userId: string) {
    const role = await this.authz.realmRole(userId);
    return { id: this.realm.id, name: this.realm.name, role };
  }

  /** List realm members. Requires the caller to be a realm member (any role). */
  async listUsers(userId: string, skip = 0, take = 50) {
    await this.authz.requireRealmRole(userId, "MEMBER");
    return this.prisma.realmMember.findMany({
      where: { realmId: this.realm.id },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    });
  }

  // Owner manages maintainers; maintainers manage members. OWNER never assignable.
  async addUser(actorId: string, email: string, role: RealmRole) {
    await this.requireAuthorityOver(actorId, role);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException("no user with that email — they must register first");
    }

    const existing = await this.prisma.realmMember.findUnique({
      where: { realmId_userId: { realmId: this.realm.id, userId: user.id } },
    });
    if (existing?.role === "OWNER") {
      throw new ForbiddenException("cannot modify the realm owner");
    }
    if (existing) {
      throw new ConflictException("user is already a realm member");
    }

    return this.prisma.realmMember.create({
      data: { realmId: this.realm.id, userId: user.id, role },
      include: { user: { select: USER_SELECT } },
    });
  }

  /** Change a realm member's role. Owner-only for anything touching MAINTAINER. */
  async updateUser(actorId: string, targetUserId: string, role: RealmRole) {
    const existing = await this.getMemberOrThrow(targetUserId);
    if (existing.role === "OWNER") {
      throw new ForbiddenException("cannot change the realm owner");
    }
    // Need authority over both current and target roles.
    await this.requireAuthorityOver(actorId, existing.role);
    await this.requireAuthorityOver(actorId, role);

    return this.prisma.realmMember.update({
      where: { realmId_userId: { realmId: this.realm.id, userId: targetUserId } },
      data: { role },
      include: { user: { select: USER_SELECT } },
    });
  }

  /** Remove a realm member. Cannot remove the owner. */
  async removeUser(actorId: string, targetUserId: string) {
    const existing = await this.getMemberOrThrow(targetUserId);
    if (existing.role === "OWNER") {
      throw new ForbiddenException("cannot remove the realm owner");
    }
    await this.requireAuthorityOver(actorId, existing.role);

    // Realm is the tenant boundary: also revoke all workspace memberships + pending requests, atomically.
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.deleteMany({
        where: { userId: targetUserId, workspace: { realmId: this.realm.id } },
      });
      await tx.joinRequest.deleteMany({
        where: {
          userId: targetUserId,
          state: "PENDING",
          workspace: { realmId: this.realm.id },
        },
      });
      await tx.realmMember.delete({
        where: { realmId_userId: { realmId: this.realm.id, userId: targetUserId } },
      });
    });
    return { ok: true as const };
  }

  private async getMemberOrThrow(userId: string) {
    const member = await this.prisma.realmMember.findUnique({
      where: { realmId_userId: { realmId: this.realm.id, userId } },
    });
    if (!member) throw new NotFoundException("user is not a realm member");
    return member;
  }

  /** OWNER required to manage a MAINTAINER; MAINTAINER+ to manage a MEMBER. */
  private async requireAuthorityOver(actorId: string, targetRole: RealmRole) {
    const min: RealmRole = targetRole === "MAINTAINER" ? "OWNER" : "MAINTAINER";
    await this.authz.requireRealmRole(actorId, min);
  }
}
