import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../src/prisma/prisma.service";
import { MigrationWorkerService } from "../../src/migration/migration-worker.service";
import {
  EMPTY_SKIP_REASON,
  PARENT_SKIP_REASON,
} from "../../src/migration/migration-worker.service";
import { MigrationJobsService } from "../../src/migration/migration-jobs.service";
import { CodaClient } from "../../src/coda/coda.client";
import { FakeCoda } from "./fake-coda";
import { Rng } from "./rng";
import { Scenario, generateScenario } from "./scenario";

// The permutation harness: it wires the REAL MigrationJobsService (enqueue) and
// MigrationWorkerService (execution) to a FakeCoda + FakeRtc and a dedicated,
// namespaced Postgres test database, then asserts the six "status == reality"
// invariants after each scenario converges. Everything but Coda/rtc is the real
// production code path (real claim SQL, real advisory locks, real finalization).

// The dedicated test DB — NEVER the user's app DB. Overridable via env.
export const TEST_DATABASE_URL =
  process.env.MIGTEST_DATABASE_URL ??
  "postgresql://toddle:toddle@localhost:5432/toddle_compose_migtest";

const REALM_ID = "sim_realm";
const USER_ID = "sim_user";
const WORKSPACE_ID = "sim_ws";

// A ConfigService stub returning the tuned knobs the worker/prisma read. Sleeps are
// driven to ~0 so 10k scenarios run fast; materialization is a short, retryable poll.
function makeConfig(maxHtmlBytes: number): ConfigService<any, true> {
  const values: Record<string, unknown> = {
    DATABASE_URL: TEST_DATABASE_URL,
    TRACE_REQUESTS: false,
    MIGRATION_WORKER_INTERVAL_MS: 0, // never auto-arm; the harness drives tick()
    MIGRATION_LEASE_TTL_MS: 300_000,
    MIGRATION_BATCH_SIZE: 5,
    MIGRATION_MAX_ITEM_ATTEMPTS: 3,
    MIGRATION_MAX_TRANSIENT_ATTEMPTS: 5,
    CODA_MAX_HTML_BYTES: maxHtmlBytes,
    CODA_MATERIALIZE_TIMEOUT_MS: 30,
    CODA_MATERIALIZE_POLL_MS: 1,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService<any, true>;
}

// --- Fakes for the collaborators the sim does not exercise for real ----------

// FakeRtc: returns the deterministic frozen snapshot for a doc (content is frozen at
// enqueue anyway, so the worker never calls this — only enqueue does).
class FakeRtc {
  constructor(private readonly scenario: Scenario) {}
  getCodaHtml(
    docId: string,
  ): Promise<{ docId: string; html: string; headSeq: number; isEmpty: boolean }> {
    const node = this.scenario.nodes.find((n) => n.docId === docId);
    if (!node) throw new Error(`FakeRtc: unknown doc ${docId}`);
    return Promise.resolve({
      docId,
      html: node.html,
      headSeq: 100,
      isEmpty: node.isEmpty,
    });
  }
}

// FakeDocuments: all docs readable at enqueue; some flip unreadable at RUN time
// (source deleted / grant revoked mid-job, P2/D7).
class FakeDocuments {
  runPhase = false;
  constructor(private readonly scenario: Scenario) {}
  assertReadable(
    _userId: string,
    docId: string,
  ): Promise<{ workspaceId: string; type: "DOC" }> {
    const node = this.scenario.nodes.find((n) => n.docId === docId);
    if (!node) return Promise.reject(new Error("not found"));
    if (this.runPhase && node.unreadableAtRun) {
      return Promise.reject(new Error("not readable"));
    }
    return Promise.resolve({ workspaceId: WORKSPACE_ID, type: "DOC" });
  }
}

// FakeAuthz: enqueuer is a workspace EDITOR (passes the P8b gate).
const fakeAuthz = {
  requireWorkspaceRole: () => Promise.resolve("EDIT"),
  requireRealmRole: () => Promise.resolve("MAINTAINER"),
} as any;

const fakeRealm = { id: REALM_ID } as any;

// FakeScopeValidation: an override row's URL encodes its pre-existing target page id.
const fakeScopeValidation = {
  validateDestinationUrl: (_scopeId: string, url: string) => {
    const codaPageId = url.replace(/^override:\/\//, "");
    return Promise.resolve({ codaPageId });
  },
} as any;

// FakeCredentials: a single-token pool per scope (pacing is exercised in unit tests).
function fakeCredentials(seed: number) {
  return { getTokenPool: () => Promise.resolve([`tok_${seed}`]) } as any;
}

// --- DB lifecycle ------------------------------------------------------------

export async function connectDb(): Promise<PrismaService> {
  const prisma = new PrismaService(makeConfig(80_000));
  await prisma.onModuleInit();
  return prisma;
}

// Seed the fixed realm/user/workspace once (idempotent).
export async function seedFixtures(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO realms (id, name) VALUES ($1, 'sim') ON CONFLICT (id) DO NOTHING`,
    REALM_ID,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, 'sim@sim.test', 'x', 'Sim') ON CONFLICT (id) DO NOTHING`,
    USER_ID,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO workspaces (id, realm_id, name) VALUES ($1, $2, 'Sim WS') ON CONFLICT (id) DO NOTHING`,
    WORKSPACE_ID,
    REALM_ID,
  );
}

// Wipe per-scenario tables (keep the fixtures). CASCADE clears items/mappings.
export async function truncateScenarioData(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE migration_job_items, migration_jobs, migration_mappings, migration_scope_tokens, migration_scopes, documents RESTART IDENTITY CASCADE`,
  );
}

// --- Running one scenario ----------------------------------------------------

export interface ScenarioResult {
  seed: number;
  violations: string[];
  converged: boolean;
  ticks: number;
  // Aggregate telemetry (to confirm the harness exercises varied, real outcomes).
  jobStatus: string;
  livePages: number;
  itemCount: number;
}

export async function runScenario(
  prisma: PrismaService,
  scenario: Scenario,
): Promise<ScenarioResult> {
  await truncateScenarioData(prisma);

  // Seed the source documents (needed for the MigrationMapping FK → Document).
  await prisma.document.createMany({
    data: scenario.nodes.map((n) => ({
      id: n.docId,
      title: n.title,
      type: "DOC" as const,
      workspaceId: WORKSPACE_ID,
      ownerId: USER_ID,
    })),
  });

  // Create the destination scope row.
  const scope = await prisma.migrationScope.create({
    data: {
      workspaceId: WORKSPACE_ID,
      codaDocId: scenario.scope.codaDocId,
      codaRootPageId: scenario.scope.codaRootPageId,
      codaRootUrl: scenario.scope.codaRootUrl,
      label: "sim",
      createdById: USER_ID,
    },
    select: { id: true },
  });

  // Build the FakeCoda + register pre-existing external pages (scope root + override
  // targets) so they count as valid, always-materialized parents/targets.
  const rng = new Rng(scenario.seed ^ 0x5bd1e995);
  const coda = new FakeCoda(rng, scenario.fakeCoda);
  if (scenario.scope.codaRootPageId) {
    coda.registerExistingPage(
      scenario.scope.codaRootPageId,
      scenario.scope.rootPageName,
    );
  }
  for (const n of scenario.nodes) {
    if (n.override && n.overrideTargetPageId) {
      coda.registerExistingPage(n.overrideTargetPageId, `existing-${n.docId}`);
    }
  }

  const documents = new FakeDocuments(scenario);
  const jobs = new MigrationJobsService(
    prisma,
    fakeAuthz,
    fakeRealm,
    documents as any,
    fakeScopeValidation,
    new FakeRtc(scenario) as any,
  );

  // Enqueue via the REAL service (freezes snapshots, builds the item tree).
  const dtoItems = scenario.nodes.map((n) => ({
    sourceDocId: n.docId,
    plannedParentDocId: n.plannedParentDocId,
    title: n.title,
    destinationUrl:
      n.override && n.overrideTargetPageId
        ? `override://${n.overrideTargetPageId}`
        : undefined,
    include: true,
  }));
  const { jobId } = await jobs.enqueue(USER_ID, scope.id, {
    items: dtoItems as any,
    sourceRootDocId: scenario.rootDocId,
  });

  // Switch to run phase: unreadable sources now throw (mid-run delete/revoke).
  documents.runPhase = true;

  const config = makeConfig(scenario.maxHtmlBytes);
  const worker = new MigrationWorkerService(
    prisma,
    config,
    documents as any,
    coda as unknown as CodaClient,
    fakeCredentials(scenario.seed),
  );
  (worker as any).transientBackoffMs = 0;

  // Simulate a crashed worker: flip the (legitimately-claimable) root items to an
  // expired lease under a dead worker id so the real claim reclaims them (D9).
  if (scenario.injectDeadLease) {
    await prisma.$executeRawUnsafe(
      `UPDATE migration_job_items SET status='RUNNING', leased_by='dead-worker', leased_until = now() - interval '1 hour' WHERE job_id=$1 AND planned_parent_doc_id IS NULL AND status='PENDING'`,
      jobId,
    );
  }

  let { converged, ticks } = await drive(prisma, worker, jobId);

  // inv48: after converging, retry() the FAILED/orphan items and re-drive. They must
  // recover (or re-fail) via the SAME page — the global dup check proves no re-create.
  if (scenario.retryAfterFail && converged) {
    const job = await prisma.migrationJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (job && job.status !== "SUCCEEDED" && job.status !== "CANCELED") {
      try {
        await jobs.retry(USER_ID, jobId);
        const again = await drive(prisma, worker, jobId);
        converged = again.converged;
        ticks += again.ticks;
      } catch {
        // "no failed items to retry" (only clean skips) — nothing to re-drive.
      }
    }
  }

  const violations = await checkInvariants(prisma, scenario, jobId, coda, converged);
  const job = await prisma.migrationJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return {
    seed: scenario.seed,
    violations,
    converged,
    ticks,
    jobStatus: job?.status ?? "?",
    livePages: coda.livePages().length,
    itemCount: scenario.nodes.length,
  };
}

// Drive the real worker's tick() to convergence (no PENDING/RUNNING left), with a
// wall-clock watchdog so an (undiscovered) livelock is flagged, never hangs the run.
async function drive(
  prisma: PrismaService,
  worker: MigrationWorkerService,
  jobId: string,
): Promise<{ converged: boolean; ticks: number }> {
  (worker as any).stopped = false;
  const watchdog = setTimeout(() => {
    (worker as any).stopped = true;
  }, 5_000);
  let ticks = 0;
  let converged = false;
  try {
    for (let i = 0; i < 2_000; i++) {
      if ((worker as any).stopped) break;
      ticks++;
      await (worker as any).tick();
      const inFlight = await prisma.migrationJobItem.count({
        where: { jobId, status: { in: ["PENDING", "RUNNING"] } },
      });
      if (inFlight === 0) {
        converged = true;
        break;
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
  return { converged, ticks };
}

// --- Invariants (docs/copy-to-coda-tests.md §7, items 43–48) -----------------

interface ItemRow {
  id: string;
  sourceDocId: string;
  plannedParentDocId: string | null;
  title: string;
  status: string;
  codaPageId: string | null;
  override: boolean;
  targetCodaPageId: string | null;
  attempts: number;
  lastError: string | null;
}

async function checkInvariants(
  prisma: PrismaService,
  scenario: Scenario,
  jobId: string,
  coda: FakeCoda,
  converged: boolean,
): Promise<string[]> {
  const v: string[] = [];
  const items = (await prisma.migrationJobItem.findMany({
    where: { jobId },
    select: {
      id: true,
      sourceDocId: true,
      plannedParentDocId: true,
      title: true,
      status: true,
      codaPageId: true,
      override: true,
      targetCodaPageId: true,
      attempts: true,
      lastError: true,
    },
  })) as ItemRow[];
  const job = await prisma.migrationJob.findUnique({ where: { id: jobId } });
  const nodeByDoc = new Map(scenario.nodes.map((n) => [n.docId, n]));

  // Convergence: no PENDING/RUNNING left.
  if (!converged) {
    v.push(`NON-CONVERGENCE: job did not converge (PENDING/RUNNING remain)`);
    return v; // downstream assertions assume a settled job
  }

  // --- 47: parent materialized before any child create used it (H2 ordering) --
  for (const violation of coda.violations) {
    v.push(`INV47(parent-ordering): ${violation}`);
  }

  // --- 44 & 48: no duplicate page per (sourceDoc, scope); retry reuses the page --
  for (const [name, count] of coda.createCallsByName) {
    if (count > 1) {
      v.push(`INV44(dup): ${count} create calls for page name "${name}" (duplicate)`);
    }
  }

  // Per-item checks.
  for (const it of items) {
    const node = nodeByDoc.get(it.sourceDocId)!;
    const page = it.codaPageId ? coda.pages.get(it.codaPageId) : undefined;
    const pageLive = !!page && !page.deleted;
    const contentMatches = !!page && page.content === node.html;

    // 43: status == reality. A page that EXISTS with the correct frozen content ⇒
    // the item MUST be SUCCEEDED (the "created but FAILED" bug).
    if (pageLive && contentMatches && it.status !== "SUCCEEDED") {
      v.push(
        `INV43(created-but-not-succeeded): item ${it.id} doc ${it.sourceDocId} status=${it.status} but page ${it.codaPageId} exists with correct content (lastError="${it.lastError}")`,
      );
    }

    // A SUCCEEDED item must have a real page id and (if still live) the right content.
    if (it.status === "SUCCEEDED") {
      if (!it.codaPageId) {
        v.push(`INV43(succeeded-no-page): item ${it.id} SUCCEEDED without a codaPageId`);
      } else if (page && !page.deleted && !contentMatches) {
        v.push(
          `INV43(succeeded-wrong-content): item ${it.id} SUCCEEDED but page content mismatches frozen snapshot`,
        );
      }
    }

    // Skip reasons must reflect reality (no spurious skips of real docs).
    if (it.status === "SKIPPED") {
      const reason = it.lastError ?? "";
      if (reason === EMPTY_SKIP_REASON && !node.isEmpty) {
        v.push(`INV45(spurious-empty-skip): item ${it.id} skipped empty but source non-empty`);
      }
      if (reason === "source not readable at run time" && !node.unreadableAtRun) {
        v.push(`INV45(spurious-unreadable-skip): item ${it.id} skipped unreadable but source was readable`);
      }
      const known = [
        EMPTY_SKIP_REASON,
        "source not readable at run time",
        PARENT_SKIP_REASON,
      ];
      if (!known.includes(reason)) {
        v.push(`INV45(unexpected-skip-reason): item ${it.id} reason="${reason}"`);
      }
    }
  }

  // --- 45: job status is EXACTLY the function of the terminal item states -------
  const S = items.filter((i) => i.status === "SUCCEEDED").length;
  const F = items.filter((i) => i.status === "FAILED").length;
  const skipped = items.filter((i) => i.status === "SKIPPED");
  const emptySkip = skipped.filter((i) => i.lastError === EMPTY_SKIP_REASON).length;
  const tainting = skipped.length - emptySkip;
  const expected =
    F === 0 && tainting === 0 ? "SUCCEEDED" : S > 0 ? "PARTIAL" : "FAILED";
  if (job?.status !== expected) {
    v.push(
      `INV45(job-status): job=${job?.status} expected=${expected} (S=${S} F=${F} tainting=${tainting} empty=${emptySkip})`,
    );
  }

  // --- 46 & 43 (strong): a pure-transient run MUST converge to all-SUCCEEDED -----
  if (scenario.pureTransient) {
    if (job?.status !== "SUCCEEDED") {
      v.push(`INV46(transient-converge): pure-transient job=${job?.status} expected SUCCEEDED`);
    }
    for (const it of items) {
      if (it.status !== "SUCCEEDED") {
        v.push(`INV46(transient-converge): item ${it.id} status=${it.status} (expected SUCCEEDED)`);
        continue;
      }
      const page = it.codaPageId ? coda.pages.get(it.codaPageId) : undefined;
      if (!page || page.deleted) {
        v.push(`INV46(transient-converge): item ${it.id} SUCCEEDED but no live page`);
      } else if (page.content !== nodeByDoc.get(it.sourceDocId)!.html) {
        v.push(`INV46(transient-converge): item ${it.id} page content mismatch`);
      }
    }
  }

  return v;
}

export { generateScenario };
