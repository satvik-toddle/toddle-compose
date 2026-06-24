import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@app/rtc-database";
import type { Env } from "../config/env";

@Injectable()
export class PrismaService
  extends PrismaClient<{
    adapter: PrismaPg;
    log: { emit: "event"; level: "query" }[];
  }>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly config: ConfigService<Env, true>) {
    // Prisma 7 removed the `datasources` constructor option and now requires a
    // driver adapter; the connection string flows through @prisma/adapter-pg.
    super({
      adapter: new PrismaPg({
        connectionString: config.get("RTC_DATABASE_URL", { infer: true }),
      }),
      // Only emit query events when tracing, so there's no per-query overhead
      // in normal operation.
      log: config.get("TRACE_REQUESTS", { infer: true })
        ? [{ emit: "event", level: "query" }]
        : [],
    });
  }

  async onModuleInit(): Promise<void> {
    // Log each query's duration when tracing is enabled. Prisma 7 removed the
    // $use middleware API, so this listens for query events instead — it reports
    // the executed SQL + duration rather than the old model.action label. Read
    // straight from the validated config since onModuleInit runs before the
    // bootstrap flag in main.ts is set.
    if (this.config.get("TRACE_REQUESTS", { infer: true })) {
      this.$on("query", (event) => {
        console.log(`[trace] db ${event.duration}ms — ${event.query}`);
      });
    }
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
