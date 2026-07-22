import { Logger } from "@nestjs/common";
import type { PrismaService } from "../../src/prisma/prisma.service";
import {
  connectDb,
  seedFixtures,
  runScenario,
  generateScenario,
} from "./harness";

// The 10k-scenario stability harness. Drives the REAL worker/job engine against a
// FakeCoda + a dedicated Postgres test DB, asserting the six invariants
// (docs/copy-to-coda-tests.md §7). Any failure prints its integer seed for a
// one-line reproduction. Not part of `test:unit` (rootDir=src) — run via `test:sim`.
//
//   SIM_SCENARIOS  how many seeds to run (default 300; CI/full = 10000+)
//   SIM_SEED_BASE  starting seed offset (default 1)

const SCENARIOS = Number(process.env.SIM_SCENARIOS ?? 300);
const SEED_BASE = Number(process.env.SIM_SEED_BASE ?? 1);
const MAX_REPORTED = 25;

// Silence the worker's per-item logs — at 10k scenarios they'd bury the report.
Logger.overrideLogger(false);

describe(`migration permutation harness (${SCENARIOS} scenarios)`, () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDb();
    await seedFixtures(prisma);
  }, 60_000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it(`converges cleanly and holds every invariant across ${SCENARIOS} seeds`, async () => {
    const failures: { seed: number; violations: string[] }[] = [];
    let totalTicks = 0;
    let totalPages = 0;
    const byStatus: Record<string, number> = {};
    const started = Date.now();

    for (let i = 0; i < SCENARIOS; i++) {
      const seed = SEED_BASE + i;
      const scenario = generateScenario(seed);
      let result;
      try {
        result = await runScenario(prisma, scenario);
      } catch (e) {
        failures.push({
          seed,
          violations: [`THREW: ${e instanceof Error ? e.stack ?? e.message : String(e)}`],
        });
        continue;
      }
      totalTicks += result.ticks;
      totalPages += result.livePages;
      byStatus[result.jobStatus] = (byStatus[result.jobStatus] ?? 0) + 1;
      if (result.violations.length > 0) {
        failures.push({ seed, violations: result.violations });
      }

      if ((i + 1) % 1000 === 0) {
        // Progress breadcrumb on the raw console (Logger is silenced).
        process.stdout.write(
          `  [sim] ${i + 1}/${SCENARIOS} done, ${failures.length} failing, ${Math.round((Date.now() - started) / 1000)}s\n`,
        );
      }
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `  [sim] finished ${SCENARIOS} scenarios in ${elapsed}s (${totalTicks} ticks, ${totalPages} live pages); ${failures.length} failing\n`,
    );
    process.stdout.write(`  [sim] job status distribution: ${JSON.stringify(byStatus)}\n`);

    if (failures.length > 0) {
      const lines = failures
        .slice(0, MAX_REPORTED)
        .map(
          (f) =>
            `  seed ${f.seed}:\n${f.violations.map((x) => `    - ${x}`).join("\n")}`,
        )
        .join("\n");
      const seeds = failures.map((f) => f.seed).join(", ");
      throw new Error(
        `${failures.length}/${SCENARIOS} scenarios FAILED.\nReproduce a single seed with SIM_SCENARIOS=1 SIM_SEED_BASE=<seed>.\nFailing seeds: ${seeds}\n${lines}`,
      );
    }
  }, 1_800_000);
});
