import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { YjsServerService } from "./yjs/yjs-server.service";
import { traceMiddleware, setTracingEnabled } from "./tracing/trace";

let app: INestApplication | null = null;

async function bootstrap() {
  // Own the JSON body limit: the internal content-search route receives up to 5000 doc
  // ids (~140KB), over Express's 100kb default — which would 413 and break search.
  const expressApp = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  expressApp.useBodyParser("json", { limit: "2mb" });
  app = expressApp;
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  // Per-request HTTP tracing: times each request and logs its DB-query breakdown.
  setTracingEnabled(config.get<boolean>("TRACE_REQUESTS") ?? false);
  app.use(traceMiddleware);
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
