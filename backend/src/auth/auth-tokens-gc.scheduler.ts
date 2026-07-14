import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

// Daily GC of dead refresh tokens; revoked rows are kept RETENTION_DAYS so reuse-detection still fires.
@Injectable()
export class AuthTokensGcScheduler {
  private readonly log = new Logger("AuthTokensGc");
  private static readonly REVOKED_RETENTION_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    const now = new Date();
    const revokedCutoff = new Date(
      now.getTime() - AuthTokensGcScheduler.REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    // Refresh tokens: drop expired ones and revoked ones past the retention
    // window. Verification + reset tokens are short-lived and single-use, so
    // expired-or-consumed rows can go immediately.
    const staleSingleUse = {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    };
    const staleRevocable = {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedCutoff } }],
    };
    const [refresh, access, verif, resets] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: staleRevocable }),
      this.prisma.personalAccessToken.deleteMany({ where: staleRevocable }),
      this.prisma.emailVerificationToken.deleteMany({ where: staleSingleUse }),
      this.prisma.passwordResetToken.deleteMany({ where: staleSingleUse }),
    ]);

    const total = refresh.count + access.count + verif.count + resets.count;
    if (total > 0) {
      this.log.log(
        `purged ${total} stale token(s) (refresh=${refresh.count} access=${access.count} verify=${verif.count} reset=${resets.count})`
      );
    }
  }
}
