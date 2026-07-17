import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, RealmRole } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveRealmService } from "./active-realm.service";
import { AuthzService } from "./authz.service";

// Never expose passwordHash.
const USER_SELECT = { id: true, email: true, name: true, color: true } as const;

// Bare host like "toddle.test": dot-separated labels, no scheme/@/path. Matches what
// register compares against (email.split("@")[1]); rejects typos that would silently
// lock out every legitimate sign-up.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

@Injectable()
export class RealmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realm: ActiveRealmService,
    private readonly authz: AuthzService
  ) {}

  async info(userId: string) {
    const role = await this.authz.realmRole(userId);
    const realm = await this.prisma.realm.findUnique({
      where: { id: this.realm.id },
      select: { joinRequestsEnabled: true },
    });
    // joinRequestsEnabled is public so non-members can see the request-to-join option.
    const base = {
      id: this.realm.id,
      name: this.realm.name,
      role,
      joinRequestsEnabled: realm?.joinRequestsEnabled ?? false,
    };
    // The allowlist is admin-only config; don't disclose it to members/non-members.
    if (role !== "OWNER" && role !== "MAINTAINER") return base;
    const admin = await this.prisma.realm.findUnique({
      where: { id: this.realm.id },
      select: { allowedEmailDomains: true },
    });
    return { ...base, allowedEmailDomains: admin?.allowedEmailDomains ?? [] };
  }

  /** Update realm settings; OWNER only. Only provided keys are written; domains normalised. */
  async updateSettings(
    actorId: string,
    settings: { allowedEmailDomains?: string[]; joinRequestsEnabled?: boolean }
  ) {
    await this.authz.requireRealmRole(actorId, "OWNER");
    const data: Prisma.RealmUpdateInput = {};
    if (settings.allowedEmailDomains !== undefined) {
      data.allowedEmailDomains = this.normalizeDomains(settings.allowedEmailDomains);
    }
    if (settings.joinRequestsEnabled !== undefined) {
      data.joinRequestsEnabled = settings.joinRequestsEnabled;
    }
    const realm = await this.prisma.realm.update({
      where: { id: this.realm.id },
      data,
      select: {
        id: true,
        name: true,
        allowedEmailDomains: true,
        joinRequestsEnabled: true,
      },
    });
    return { ...realm, role: "OWNER" as RealmRole };
  }

  // Bare lowercase hosts, "@" / whitespace stripped, blanks dropped, de-duplicated.
  // Rejects entries that aren't valid domains so a typo can't silently gate out everyone.
  private normalizeDomains(domains: string[]): string[] {
    const cleaned = domains
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const invalid = cleaned.filter((d) => !DOMAIN_RE.test(d));
    if (invalid.length > 0) {
      throw new BadRequestException(`invalid email domain(s): ${invalid.join(", ")}`);
    }
    return [...new Set(cleaned)];
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

  // User-directory search for pickers: case-insensitive substring on name OR email.
  // Searches the User table (single-realm app) so registered users who haven't joined a
  // workspace yet are still findable in the Share/Add-member pickers. Open to ANY realm
  // member (workspace admins who aren't realm admins need it); omitted/blank queries
  // return the first `take` users alphabetically.
  async searchUsers(userId: string, q: string | undefined, take = 20) {
    await this.authz.requireRealmRole(userId, "MEMBER");
    return this.searchDirectory(q, take);
  }

  // Raw user-directory query with NO authz — callers MUST gate first (realm-member for
  // the realm picker, doc-manage for the doc picker). Same shape as the realm search:
  // case-insensitive name/email substring, deterministic order, capped at 20 rows.
  // Searches ALL registered users — use for add-member pickers that must find non-members.
  async searchDirectory(q: string | undefined, take = 20) {
    return this.runDirectorySearch(q, take, undefined);
  }

  // Directory search restricted to realm members ("the org") — for the doc Share picker,
  // which should only surface people who actually belong to this realm. Callers MUST gate first.
  async searchRealmMembers(q: string | undefined, take = 20) {
    return this.runDirectorySearch(q, take, {
      realmMemberships: { some: { realmId: this.realm.id } },
    });
  }

  private runDirectorySearch(
    q: string | undefined,
    take: number,
    scope: Prisma.UserWhereInput | undefined
  ) {
    const query = q?.trim() ?? "";
    const match: Prisma.UserWhereInput = query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : {};
    return this.prisma.user.findMany({
      where: { ...scope, ...match },
      select: USER_SELECT,
      // Tiebreak by id so the order is deterministic when names collide.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: Math.min(take, 20),
    });
  }

  /** Whether a user belongs to the active realm ("the org"). */
  async isMember(userId: string): Promise<boolean> {
    const member = await this.prisma.realmMember.findUnique({
      where: { realmId_userId: { realmId: this.realm.id, userId } },
      select: { userId: true },
    });
    return member !== null;
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

  // Remove a realm member (cannot remove the owner). Note: this is not a ban —
  // open discovery lets the user re-acquire membership by self-joining any PUBLIC
  // workspace. To keep someone out, make the workspaces PRIVATE (join needs approval).
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
