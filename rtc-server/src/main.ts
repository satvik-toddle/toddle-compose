import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const internalPort = config.get<number>("RTC_INTERNAL_PORT") ?? 4002;
  const wsPort = config.get<number>("RTC_PORT") ?? 4001;
  await app.listen(internalPort);
  new Logger("bootstrap").log(
    `rtc-server: internal HTTP on :${internalPort}, WS on :${wsPort}`
  );
}

process.on("uncaughtException", (e) =>
  new Logger("rtc").error("uncaughtException", e)
);
process.on("unhandledRejection", (e) =>
  new Logger("rtc").error("unhandledRejection", e as Error)
);

bootstrap();
