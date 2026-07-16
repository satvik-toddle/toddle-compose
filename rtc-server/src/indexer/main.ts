import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IndexerAppModule } from "./indexer-app.module";
import { IndexerService } from "./indexer.service";
import type { Env } from "../config/env";

// Detached indexer worker: its own process (extraction CPU isolated from the WS event loop),
// with access to BOTH databases — reads the rtc queue/state, writes the backend projection.
// Exposes a tiny /wake HTTP surface that rtc pings after enqueuing.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(IndexerAppModule);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get("INDEXER_PORT", { infer: true });
  await app.listen(port);
  app.get(IndexerService).start();
  new Logger("indexer").log(`search indexer worker on :${port}`);
}

// On an uncaught error, exit non-zero so the supervisor restarts us; queue rows are durable and
// writes are idempotent (G3), so a restart just resumes the drain safely.
function crash(kind: string, e: unknown): void {
  new Logger("indexer").error(kind, e instanceof Error ? e.stack : e);
  process.exit(1);
}

process.on("uncaughtException", (e) => crash("uncaughtException", e));
process.on("unhandledRejection", (e) => crash("unhandledRejection", e));

void bootstrap();
