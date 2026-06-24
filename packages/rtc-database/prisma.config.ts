import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env. Load the single root .env so the schema's
// url = env("RTC_DATABASE_URL") and the CLI resolve the connection string. Path
// is relative to the package dir (the cwd when pnpm runs prisma here). dotenv
// no-ops if the file is absent, e.g. CI `prisma generate`.
loadEnv({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Read directly off process.env (not the throwing `env()` helper) so CLI
    // commands that don't touch the database — notably CI `prisma generate`,
    // which runs with no .env — don't fail on an absent RTC_DATABASE_URL.
    url: process.env.RTC_DATABASE_URL,
  },
});
