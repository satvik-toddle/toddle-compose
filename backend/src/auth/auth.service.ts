import {
  BadRequestException,
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
import { MailerService } from "../mailer/mailer.service";
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

// Returned by register/resend: no session is issued until the email is verified.
export type VerificationPending = {
  status: "verification_sent";
  email: string;
  // false when the mailer is in dev/console mode (link logged, not delivered).
  emailDelivered: boolean;
};

// Returned by forgot-password: a fixed generic shape so neither the body nor a
// boolean reveals whether the address has an account.
export type ResetEmailSent = {
  status: "reset_email_sent";
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly mailer: MailerService
  ) {}

  // Self-signup is gated on the realm's email-domain allowlist; realm membership is then
  // acquired by discovering and joining a workspace (no realm-admin step required).
  // Sign-up does not issue a session: it creates an UNVERIFIED user and emails a
  // short-lived verification link. The client must verify before logging in.
  async register(
    email: string,
    password: string,
    name: string
  ): Promise<VerificationPending> {
    const realmId = this.config.get("REALM_ID", { infer: true });
    const realm = await this.prisma.realm.findUnique({ where: { id: realmId } });
    if (!realm) throw new ForbiddenException("registration is not available");
    this.assertEmailDomainAllowed(email, realm.allowedEmailDomains);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // A verified account is a genuine conflict; an unverified one most likely
      // means the first email was missed, so just resend (without leaking which).
      if (existing.emailVerifiedAt) {
        throw new ConflictException("email already registered");
      }
      const delivered = await this.issueVerification(existing);
      return { status: "verification_sent", email, emailDelivered: delivered };
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const user = await this.prisma.user.create({
      data: { email, name, color, passwordHash },
    });
    const delivered = await this.issueVerification(user);
    return { status: "verification_sent", email, emailDelivered: delivered };
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
    // Signed in without verifying → the "user not authenticated" state.
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: "EMAIL_NOT_VERIFIED",
        message: "email address has not been verified",
      });
    }
    return this.issueTokens(user);
  }

  // Consume a verification link. Success flips the account to verified; any
  // invalid/expired/already-used token is rejected so the UI can show "declined".
  async verifyEmail(rawToken: string): Promise<{ status: "verified"; email: string }> {
    const tokenHash = this.hash(rawToken);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) throw new BadRequestException("invalid verification token");

    // Idempotent: re-clicking a link that already verified this account succeeds.
    if (record.consumedAt) {
      if (record.user.emailVerifiedAt) {
        return { status: "verified", email: record.user.email };
      }
      throw new BadRequestException("verification token already used");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("verification token expired");
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: now },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      }),
      // Invalidate any other outstanding tokens for this user.
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: now },
      }),
    ]);
    return { status: "verified", email: record.user.email };
  }

  // Re-send a verification link. Always reports success (never leaks whether the
  // address exists or is already verified).
  async resendVerification(email: string): Promise<VerificationPending> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    let emailDelivered = false;
    if (user && !user.emailVerifiedAt) {
      emailDelivered = await this.issueVerification(user);
    }
    return { status: "verification_sent", email, emailDelivered };
  }

  // "Forgot password": email a reset link if the address has an account. Always
  // reports success generically (never leaks whether the address exists).
  async requestPasswordReset(email: string): Promise<ResetEmailSent> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) await this.issuePasswordReset(user);
    return { status: "reset_email_sent" };
  }

  // Consume a reset link and set a new password. Any invalid/expired/used token
  // is rejected so the UI can show the link is no longer valid.
  async resetPassword(
    rawToken: string,
    newPassword: string
  ): Promise<{ status: "reset" }> {
    const tokenHash = this.hash(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) throw new BadRequestException("invalid reset token");
    if (record.consumedAt) throw new BadRequestException("reset token already used");
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("reset token expired");
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Clicking the emailed link also proves ownership of the address.
        data: { passwordHash, emailVerifiedAt: record.user.emailVerifiedAt ?? now },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: now },
      }),
      // Invalidate any other outstanding reset tokens for this user.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: now },
      }),
      // A password change revokes every existing session (force re-login).
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    return { status: "reset" };
  }

  // Mint a fresh verification token (invalidating prior unconsumed ones) and
  // email the link. Returns whether the mail was actually delivered.
  private async issueVerification(user: DbUser): Promise<boolean> {
    const ttl = this.config.get("EMAIL_VERIFICATION_TTL_SEC", { infer: true });
    const frontendUrl = this.config
      .get("FRONTEND_URL", { infer: true })
      .replace(/\/+$/, "");

    // Per-account cooldown: at most one verification email per window. The
    // existing token stays valid; we simply don't send another.
    const last = await this.prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (this.isWithinCooldown(last?.createdAt ?? null)) return false;

    const rawToken = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(rawToken),
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      }),
    ]);

    const verifyUrl = `${frontendUrl}/verify-email?token=${rawToken}`;
    const { delivered } = await this.mailer.sendEmailVerification(user.email, {
      name: user.name,
      verifyUrl,
      expiresInMinutes: Math.round(ttl / 60),
    });
    return delivered;
  }

  // Mint a fresh reset token (invalidating prior unconsumed ones) and email the
  // link. Returns whether the mail was actually delivered.
  private async issuePasswordReset(user: DbUser): Promise<boolean> {
    const ttl = this.config.get("PASSWORD_RESET_TTL_SEC", { infer: true });
    const frontendUrl = this.config
      .get("FRONTEND_URL", { infer: true })
      .replace(/\/+$/, "");

    // Per-account cooldown: at most one reset email per window.
    const last = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (this.isWithinCooldown(last?.createdAt ?? null)) return false;

    const rawToken = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(rawToken),
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      }),
    ]);

    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    const { delivered } = await this.mailer.sendPasswordReset(user.email, {
      name: user.name,
      resetUrl,
      expiresInMinutes: Math.round(ttl / 60),
    });
    return delivered;
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

  // True when an email was sent to this account within the cooldown window, so
  // a fresh token/email should be suppressed (enforced per account, not per IP).
  private isWithinCooldown(lastSentAt: Date | null): boolean {
    const cooldown = this.config.get("EMAIL_RESEND_COOLDOWN_SEC", { infer: true });
    if (cooldown <= 0 || !lastSentAt) return false;
    return Date.now() - lastSentAt.getTime() < cooldown * 1000;
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
