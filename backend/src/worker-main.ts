import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WorkerAppModule } from "./coda-import/worker.module";
import type { Env } from "./config/env";

// Entry point for the STANDALONE import-worker process. Mirrors main.ts's bootstrap
// (global pipes, shutdown hooks) but boots WorkerAppModule and listens on
// IMPORT_WORKER_PORT. The /run wake-up route is kept at the ROOT path (excluded from
// the /api prefix) because CodaImportWorkerClient pings ${IMPORT_WORKER_URL}/run.
async function bootstrap() {
  const app = await NestFactory.create(WorkerAppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix("api", { exclude: ["run", "health"] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Fire OnApplicationShutdown so the worker's self-arming timer is torn down cleanly.
  app.enableShutdownHooks();

  const port = config.get("IMPORT_WORKER_PORT", { infer: true });
  await app.listen(port);
  new Logger("WorkerBootstrap").log(
    `import worker listening on http://localhost:${port} (POST /run to wake)`,
  );
}

void bootstrap();
