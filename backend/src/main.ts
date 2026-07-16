import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { corsOrigins, type Env } from "./config/env";
import { traceMiddleware, setTracingEnabled } from "./tracing/trace";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Own the JSON body limit: the bulk index-content endpoint receives a batch of doc texts,
  // well over Express's 100kb default which would 413 the worker's pushes.
  app.useBodyParser("json", { limit: "8mb" });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Per-request tracing: times each request and logs its DB-query breakdown.
  setTracingEnabled(config.get("TRACE_REQUESTS", { infer: true }));
  app.use(traceMiddleware);

  // CORS restricted to the configured allowlist (no wildcard).
  app.enableCors({
    origin: corsOrigins(config.get("CORS_ORIGINS", { infer: true })),
    credentials: true,
  });

  // /api prefix for app routes; health + JWKS stay at the root.
  app.setGlobalPrefix("api", {
    exclude: ["health", ".well-known/rtc-jwks.json"],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = config.get("BACKEND_PORT", { infer: true });
  await app.listen(port);
  new Logger("Bootstrap").log(`backend listening on http://localhost:${port}`);
}

void bootstrap();
