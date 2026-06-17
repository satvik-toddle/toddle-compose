import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

let app: INestApplication | null = null;

async function bootstrap() {
  app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const internalPort = config.get<number>("RTC_INTERNAL_PORT") ?? 4002;
  const wsPort = config.get<number>("RTC_PORT") ?? 4001;
  await app.listen(internalPort);
  new Logger("bootstrap").log(
    `rtc-server: internal HTTP on :${internalPort}, WS on :${wsPort}`
  );
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
