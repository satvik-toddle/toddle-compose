import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env (v5/v6 did). The monorepo keeps a single
// root .env; load it here so the schema's url = env("DATABASE_URL") and every
// CLI command (migrate/db push/seed) resolve the connection string. The path is
// relative to the package dir, which is the cwd when `pnpm --filter @app/database`
// runs prisma. dotenv no-ops if the file is absent (e.g. CI `prisma generate`,
// which doesn't need a database connection).
loadEnv({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Read directly off process.env (not the throwing `env()` helper) so CLI
    // commands that don't touch the database — notably CI `prisma generate`,
    // which runs with no .env — don't fail on an absent DATABASE_URL.
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Moved off the deprecated package.json#prisma.seed key, which v7 ignores.
    seed: "tsx prisma/seed.ts",
  },
});
