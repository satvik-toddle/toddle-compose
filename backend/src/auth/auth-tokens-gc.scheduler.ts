import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Daily garbage collection of dead refresh tokens: rows that have expired, or
 * were revoked (rotation/logout) more than RETENTION_DAYS ago. Revoked rows are
 * kept for a while so reuse-detection (token-theft signal) still fires.
 */
@Injectable()
export class AuthTokensGcScheduler {
  private readonly log = new Logger("AuthTokensGc");
  private static readonly REVOKED_RETENTION_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    const revokedCutoff = new Date(
      Date.now() - AuthTokensGcScheduler.REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    const res = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: revokedCutoff } }],
      },
    });
    if (res.count > 0) {
      this.log.log(`purged ${res.count} expired/long-revoked refresh token(s)`);
    }
  }
}
