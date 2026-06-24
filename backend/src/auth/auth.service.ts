import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
// Native bcrypt hashes on the libuv thread pool; bcryptjs would block the event loop per hash.
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { Env } from "../config/env";
import type { AuthUser } from "./current-user.decorator";

const PALETTE = [
  "#f04c54",
  "#5a5ae2",
  "#00ac8a",
  "#e8653a",
  "#b646ee",
  "#00b0c2",
  "#ef4371",
];

const BCRYPT_ROUNDS = 12;

type DbUser = { id: string; email: string; name: string; color: string };

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime, seconds
  user: AuthUser;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>
  ) {}

  // Self-signup is gated on the realm's email-domain allowlist. Realm membership is then
  // acquired by discovering and joining a workspace (no realm-admin step required).
  async register(
    email: string,
    password: string,
    name: string
  ): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("email already registered");

    const realmId = this.config.get("REALM_ID", { infer: true });
    const realm = await this.prisma.realm.findUnique({ where: { id: realmId } });
    if (!realm) throw new ForbiddenException("registration is not available");
    this.assertEmailDomainAllowed(email, realm.allowedEmailDomains);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const user = await this.prisma.user.create({
      data: { email, name, color, passwordHash },
    });
    return this.issueTokens(user);
  }

  // Empty allowlist = open registration; otherwise the email's domain must be listed.
  private assertEmailDomainAllowed(email: string, allowed: string[]): void {
    if (allowed.length === 0) return;
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !allowed.includes(domain)) {
      throw new ForbiddenException("this email isn't authorised to join this realm");
    }
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("invalid credentials");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("invalid credentials");
    return this.issueTokens(user);
  }

  // Rotates: presented token revoked, new one issued; reuse of a revoked token is treated as compromise.
  async refresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.hash(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException("invalid refresh token");

    if (record.revokedAt) {
      // Reuse of an already-rotated token => likely theft; revoke the whole family.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("refresh token already used");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("refresh token expired");
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(record.user);
  }

  // Logout; idempotent — unknown tokens are a no-op.
  async logout(rawToken: string): Promise<{ ok: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  // Mint an access JWT; activeWorkspaceId scopes the session. Roles are never in the token (resolved per request by AuthzService).
  async mintAccessToken(
    user: { id: string; email: string },
    opts?: { activeWorkspaceId?: string | null }
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const accessTtl = this.config.get("ACCESS_TOKEN_TTL_SEC", { infer: true });
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      type: "access",
    };
    if (opts?.activeWorkspaceId) payload.activeWorkspaceId = opts.activeWorkspaceId;
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: `${accessTtl}s`,
    });
    return { accessToken, expiresIn: accessTtl };
  }

  private async issueTokens(user: DbUser): Promise<TokenPair> {
    const refreshTtl = this.config.get("REFRESH_TOKEN_TTL_SEC", { infer: true });

    const { accessToken, expiresIn } = await this.mintAccessToken(user);

    const refreshToken = randomBytes(32).toString("base64url");
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: this.sanitize(user),
    };
  }

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  sanitize(user: DbUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      activeWorkspaceId: null,
    };
  }
}
