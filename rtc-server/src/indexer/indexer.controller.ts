import { Controller, Post } from "@nestjs/common";
import { IndexerService } from "./indexer.service";

// The worker's only route. rtc pings this after enqueuing; the response tells rtc when the next
// sweep will run so it can suppress further pings until then. No auth: bind the worker to a
// private interface in prod (same posture as the other internal services).
@Controller()
export class IndexerController {
  constructor(private readonly indexer: IndexerService) {}

  @Post("wake")
  wake(): { nextRunAt: number } {
    return this.indexer.wake();
  }
}
