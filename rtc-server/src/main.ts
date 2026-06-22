import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { YjsServerService } from "./yjs/yjs-server.service";
import { traceMiddleware } from "./tracing/trace";

let app: INestApplication | null = null;

async function bootstrap() {
  app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Per-request HTTP tracing: times each request and logs a span breakdown.
  app.use(traceMiddleware);
  const config = app.get(ConfigService);
  const port = config.get<number>("RTC_PORT") ?? 4001;
  await app.listen(port);
  app.get(YjsServerService).attach(app.getHttpServer());
  new Logger("bootstrap").log(`rtc-server: HTTP + WS on :${port}`);
}

// On uncaught error, attempt a timeout-bounded graceful close, then exit non-zero for the supervisor to restart.
const CRASH_SHUTDOWN_TIMEOUT_MS = 5000;
let crashing = false;

async function crash(kind: string, e: unknown): Promise<void> {
  const logger = new Logger("rtc");
  logger.error(kind, e instanceof Error ? e.stack : e);
  if (crashing) return;
  crashing = true;
  try {
    const timeout = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, CRASH_SHUTDOWN_TIMEOUT_MS);
      t.unref();
    });
    await Promise.race([app?.close(), timeout]);
  } catch (closeErr) {
    logger.error("graceful close after crash failed", closeErr);
  }
  process.exit(1);
}

process.on("uncaughtException", (e) => void crash("uncaughtException", e));
process.on("unhandledRejection", (e) => void crash("unhandledRejection", e));

bootstrap();
