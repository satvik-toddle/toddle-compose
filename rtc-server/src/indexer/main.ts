import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { IndexerAppModule } from "./indexer-app.module";
import { IndexerService } from "./indexer.service";

// Headless worker: no HTTP/WS server, just the sweep loop over its own process. Kept separate
// from the collab server so extraction CPU is isolated (search-indexing.md §7).
async function bootstrap(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(IndexerAppModule);
  ctx.enableShutdownHooks();
  ctx.get(IndexerService).start();
  new Logger("indexer").log("search indexer worker up");
}

// On an uncaught error, log and exit non-zero so the supervisor restarts us; queue rows are
// durable and pushes are idempotent (G3), so a restart just resumes the drain safely.
function crash(kind: string, e: unknown): void {
  new Logger("indexer").error(kind, e instanceof Error ? e.stack : e);
  process.exit(1);
}

process.on("uncaughtException", (e) => crash("uncaughtException", e));
process.on("unhandledRejection", (e) => crash("unhandledRejection", e));

void bootstrap();
