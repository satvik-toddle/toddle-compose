import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // HTTP port for the internal API + health. The raw Yjs WebSocket server
  // (RTC_PORT) is wired in Phase 2.
  const port = Number(process.env.RTC_INTERNAL_PORT ?? 4002);
  await app.listen(port);
  new Logger('Bootstrap').log(`rtc-server (http) listening on http://localhost:${port}`);
}

void bootstrap();
