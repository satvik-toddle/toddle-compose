import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { JoinRequestState } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";
import { AuthzService } from "./authz.service";

// Never expose passwordHash.
const USER_SELECT = { id: true, email: true, name: true, color: true } as const;

@Injectable()
export class OrgJoinRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realm: ActiveRealmService,
    private readonly authz: AuthzService
  ) {}

  /** Request to join the org (PENDING until a maintainer decides). */
  async requestJoin(userId: string) {
    const realm = await this.prisma.realm.findUnique({
      where: { id: this.realm.id },
      select: { joinRequestsEnabled: true },
    });
    if (!realm?.joinRequestsEnabled) {
      throw new ForbiddenException("joining by request is not enabled");
    }

    const member = await this.prisma.realmMember.findUnique({
      where: { realmId_userId: { realmId: this.realm.id, userId } },
    });
    if (member) throw new ConflictException("you are already a member of this organisation");

    const pending = await this.prisma.orgJoinRequest.findFirst({
      where: { realmId: this.realm.id, userId, state: "PENDING" },
    });
    if (pending) throw new ConflictException("you already have a pending request");

    return this.prisma.orgJoinRequest.create({
      data: { realmId: this.realm.id, userId },
    });
  }

  // The caller's own most recent org join request — drives the /access status poll.
  async myRequest(userId: string) {
    return this.prisma.orgJoinRequest.findFirst({
      where: { realmId: this.realm.id, userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** List org join requests (default PENDING). Requires realm MAINTAINER. */
  async list(actorId: string, state: JoinRequestState = "PENDING") {
    await this.authz.requireRealmRole(actorId, "MAINTAINER");
    return this.prisma.orgJoinRequest.findMany({
      where: { realmId: this.realm.id, state },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Approve a PENDING request → adds the realm member (requires MAINTAINER). */
  async approve(actorId: string, requestId: string) {
    await this.authz.requireRealmRole(actorId, "MAINTAINER");
    const req = await this.getPendingRequestOrThrow(requestId);

    return this.prisma.$transaction(async (tx) => {
      // Upsert without downgrade: never demote an existing role.
      const member = await tx.realmMember.upsert({
        where: { realmId_userId: { realmId: this.realm.id, userId: req.userId } },
        update: {},
        create: { realmId: this.realm.id, userId: req.userId, role: "MEMBER" },
        include: { user: { select: USER_SELECT } },
      });
      await tx.orgJoinRequest.update({
        where: { id: requestId },
        data: { state: "APPROVED", decidedById: actorId, decidedAt: new Date() },
      });
      return member;
    });
  }

  /** Reject a PENDING request (requires MAINTAINER). */
  async reject(actorId: string, requestId: string) {
    await this.authz.requireRealmRole(actorId, "MAINTAINER");
    await this.getPendingRequestOrThrow(requestId);
    await this.prisma.orgJoinRequest.update({
      where: { id: requestId },
      data: { state: "REJECTED", decidedById: actorId, decidedAt: new Date() },
    });
    return { ok: true as const };
  }

  private async getPendingRequestOrThrow(requestId: string) {
    const req = await this.prisma.orgJoinRequest.findFirst({
      where: { id: requestId, realmId: this.realm.id },
    });
    if (!req) throw new NotFoundException("join request not found");
    if (req.state !== "PENDING") {
      throw new ConflictException(`request already ${req.state.toLowerCase()}`);
    }
    return req;
  }
}
