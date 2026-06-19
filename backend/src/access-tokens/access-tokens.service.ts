import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AccessToken,
  AccessTokenPermission,
  AccessTokenScope,
} from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import {
  generateAccessToken,
  permissionToWorkspaceRole,
} from "../auth/access-token.util";
import type { CreateAccessTokenDto } from "./dto";

const DEFAULT_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessTokenView = {
  id: string;
  name: string;
  prefix: string;
  scope: AccessTokenScope;
  permission: AccessTokenPermission;
  workspaceId: string | null;
  createdById: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

@Injectable()
export class AccessTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService
  ) {}

  async create(userId: string, dto: CreateAccessTokenDto) {
    const permission = dto.permission as AccessTokenPermission;
    let workspaceId: string | null = null;

    if (dto.scope === "WORKSPACE") {
      if (!dto.workspaceId) {
        throw new BadRequestException("workspaceId is required for a WORKSPACE token");
      }
      if (permission === "MAINTAINER") {
        throw new BadRequestException("MAINTAINER permission requires a REALM token");
      }
      await this.authz.requireWorkspaceRole(
        userId,
        dto.workspaceId,
        permissionToWorkspaceRole(permission)
      );
      workspaceId = dto.workspaceId;
    } else {
      if (dto.workspaceId) {
        throw new BadRequestException("workspaceId is not allowed for a REALM token");
      }
      await this.authz.requireRealmRole(userId, "MAINTAINER");
    }

    const ttlDays = dto.expiresInDays ?? DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
    const { raw, hash, prefix } = generateAccessToken();

    const record = await this.prisma.accessToken.create({
      data: {
        name: dto.name,
        tokenHash: hash,
        prefix,
        scope: dto.scope as AccessTokenScope,
        permission,
        workspaceId,
        createdById: userId,
        expiresAt,
      },
    });

    return { token: raw, accessToken: this.toView(record) };
  }

  async list(userId: string): Promise<AccessTokenView[]> {
    const rows = await this.prisma.accessToken.findMany({
      where: { createdById: userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toView(r));
  }

  async revoke(userId: string, id: string): Promise<AccessTokenView> {
    const record = await this.prisma.accessToken.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("access token not found");

    if (record.createdById !== userId) {
      const realmRole = await this.authz.realmRole(userId);
      if (realmRole !== "OWNER" && realmRole !== "MAINTAINER") {
        throw new ForbiddenException("not allowed to revoke this token");
      }
    }

    if (record.revokedAt) return this.toView(record);
    const updated = await this.prisma.accessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return this.toView(updated);
  }

  private toView(t: AccessToken): AccessTokenView {
    return {
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scope: t.scope,
      permission: t.permission,
      workspaceId: t.workspaceId,
      createdById: t.createdById,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
