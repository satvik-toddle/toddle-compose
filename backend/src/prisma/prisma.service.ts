import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@app/database";
import type { Env } from "../config/env";
import { traceEnabled } from "../tracing/trace";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<Env, true>) {
    super({
      datasources: { db: { url: config.get("DATABASE_URL", { infer: true }) } },
    });
  }

  async onModuleInit(): Promise<void> {
    // Log each query's duration to the console (no-op when tracing is off).
    if (traceEnabled()) {
      this.$use(async (params, next) => {
        const start = performance.now();
        try {
          return await next(params);
        } finally {
          const op = params.model
            ? `${params.model}.${params.action}`
            : params.action;
          const ms = (performance.now() - start).toFixed(1);
          console.log(`[trace] db ${op} ${ms}ms`);
        }
      });
    }
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
