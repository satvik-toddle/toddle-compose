import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FoldersService } from "./folders.service";

/** Daily hard-purge of folders that have been soft-deleted for more than 30 days. */
@Injectable()
export class FoldersPurgeScheduler {
  private readonly log = new Logger("FoldersPurge");
  private static readonly RETENTION_DAYS = 30;

  constructor(private readonly folders: FoldersService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purge(): Promise<void> {
    const removed = await this.folders.purgeSoftDeleted(
      FoldersPurgeScheduler.RETENTION_DAYS
    );
    if (removed > 0) {
      this.log.log(
        `purged ${removed} folder(s) soft-deleted >${FoldersPurgeScheduler.RETENTION_DAYS}d ago`
      );
    }
  }
}
