import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  const port = Number(process.env.BACKEND_PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`backend listening on http://localhost:${port}`);
}

void bootstrap();
