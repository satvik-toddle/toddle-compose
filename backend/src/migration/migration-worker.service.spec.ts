import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import type { DocumentsService } from "../documents/documents.service";
import type { CodaClient } from "../coda/coda.client";
import type { CodaCredentialsService } from "./coda-credentials.service";
import {
  MigrationWorkerService,
  chunkHtmlByBytes,
  isTransientError,
  EMPTY_SKIP_REASON,
} from "./migration-worker.service";

const JOB = "job1";
const SCOPE = "s1";
const DOC = "cdoc1";

// A claimed READY item (already flipped to RUNNING under our lease).
function item(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "it1",
    jobId: JOB,
    sourceDocId: "d1",
    plannedParentDocId: null,
    title: "Doc One",
    targetCodaPageId: null,
    override: false,
    codaPageId: null,
    migratedSeq: null,
    // Point-in-time content FROZEN at enqueue — the worker pushes this verbatim.
    snapshotHtml: "<p>hi</p>",
    enqueuedSeq: 7,
    attempts: 0,
    seq: 0,
    ...over,
  } as any;
}

function makeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    MIGRATION_WORKER_INTERVAL_MS: 5000,
    MIGRATION_LEASE_TTL_MS: 300_000,
    MIGRATION_BATCH_SIZE: 5,
    MIGRATION_MAX_ITEM_ATTEMPTS: 3,
    CODA_MAX_HTML_BYTES: 80_000,
    CODA_MATERIALIZE_TIMEOUT_MS: 1_000,
    CODA_MATERIALIZE_POLL_MS: 5,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService<
    Env,
    true
  >;
}

interface Order {
  push: (label: string) => void;
  seen: string[];
}

function makeWorker(over?: {
  job?: any;
  scope?: any;
  freshCodaPageId?: string | null;
  parentCodaPageId?: string | null;
  assertReadable?: jest.Mock;
  counts?: {
    inFlight?: number;
    failed?: number;
    succeeded?: number;
    // "tainting" skips: SKIPPED for any reason OTHER than an empty source (orphan,
    // unreadable, dest-removed) — these keep a job off SUCCEEDED.
    orphaned?: number;
    // clean skips: SKIPPED because the source was genuinely empty (no-op).
    emptySkip?: number;
  };
  finishItemCount?: number;
}) {
  const order: Order = { seen: [], push(l) { this.seen.push(l); } };

  const job =
    over?.job === undefined
      ? { id: JOB, scopeId: SCOPE, status: "RUNNING", createdById: "u1", startedAt: new Date() }
      : over.job;

  const scope =
    over?.scope === undefined
      ? { codaDocId: DOC, codaRootPageId: null }
      : over.scope;

  // Interactive-tx surface shared by createOrOverride / upsertMapping / finishItem.
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    migrationJobItem: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ codaPageId: over?.freshCodaPageId ?? null }),
      update: jest.fn(async () => {
        order.push("persist-codaPageId");
        return {};
      }),
      updateMany: jest.fn().mockResolvedValue({ count: over?.finishItemCount ?? 1 }),
    },
    migrationMapping: { upsert: jest.fn().mockResolvedValue({}) },
    migrationJob: { update: jest.fn().mockResolvedValue({}) },
  };

  const counts = over?.counts ?? {};
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
    ),
    migrationJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    migrationScope: { findFirst: jest.fn().mockResolvedValue(scope) },
    migrationMapping: { upsert: jest.fn() },
    migrationJobItem: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ codaPageId: over?.parentCodaPageId ?? "parentPage" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn(async (arg: any) => {
        // maybeFinalizeJob counts by status: inFlight (status.in), FAILED, SUCCEEDED,
        // total SKIPPED, and clean-empty SKIPPED (lastError=EMPTY_SKIP_REASON).
        const w = arg?.where ?? {};
        if (w.status && typeof w.status === "object" && Array.isArray(w.status.in)) {
          return counts.inFlight ?? 0;
        }
        if (w.status === "FAILED") return counts.failed ?? 0;
        if (w.status === "SUCCEEDED") return counts.succeeded ?? 1;
        if (w.status === "SKIPPED") {
          const emptySkip = counts.emptySkip ?? 0;
          // A clean-empty count is keyed on the empty-source reason; the plain
          // SKIPPED count is the total (tainting orphans + clean-empty).
          return w.lastError === EMPTY_SKIP_REASON
            ? emptySkip
            : (counts.orphaned ?? 0) + emptySkip;
        }
        return 0;
      }),
    },
  } as unknown as PrismaService;

  const documents = {
    assertReadable:
      over?.assertReadable ??
      jest.fn().mockResolvedValue({ workspaceId: "w1", type: "DOC" }),
  } as unknown as DocumentsService;

  const coda = {
    createPage: jest.fn(async () => {
      order.push("createPage");
      return { id: "newPage", requestId: "req1" };
    }),
    replacePageContent: jest.fn(async () => {
      order.push("replacePageContent");
      return { id: "ignored", requestId: "req2" };
    }),
    appendPageContent: jest.fn(async () => {
      order.push("appendPageContent");
      return { id: "x", requestId: "reqA" };
    }),
    awaitMutation: jest.fn(async () => {
      order.push("awaitMutation");
    }),
    getPage: jest.fn().mockResolvedValue({ browserLink: "https://coda.io/d/x/p" }),
    // Materialization poll: default = page is queryable on the first poll.
    getPageOrNull: jest.fn(async () => {
      order.push("getPageOrNull");
      return { browserLink: "https://docs.superhuman.com/d/x/_su1" };
    }),
  } as unknown as CodaClient;

  const credentials = {
    getTokenPool: jest.fn().mockResolvedValue(["tokA", "tokB"]),
  } as unknown as CodaCredentialsService;

  const svc = new MigrationWorkerService(
    prisma,
    makeConfig(),
    documents,
    coda,
    credentials,
  );

  return { svc, prisma, tx, documents, coda, credentials, order };
}

// processItem is private; exercise it directly.
function run(svc: MigrationWorkerService, it: any): Promise<void> {
  return (svc as any).processItem(it);
}

describe("MigrationWorkerService.claimBatch (D9 lease/claim SQL)", () => {
  it("emits an atomic UPDATE with SKIP LOCKED, lease reclaim, and the parent-readiness gate", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).claimBatch();

    const call = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    const sql = (call[0] as string[]).join("?");
    const params = call.slice(1);

    // Atomic conditional UPDATE flips to RUNNING under a lease.
    expect(sql).toMatch(/UPDATE migration_job_items/i);
    expect(sql).toMatch(/status = 'RUNNING'/);
    expect(sql).toMatch(/leased_by =/);
    expect(sql).toMatch(/leased_until =/);
    // Never double-process: SKIP LOCKED + FOR UPDATE on the candidate rows.
    expect(sql).toMatch(/FOR UPDATE OF c SKIP LOCKED/);
    // Only live jobs; PENDING or a RUNNING item whose lease expired (crash reclaim).
    expect(sql).toMatch(/j\.status IN \('QUEUED', 'RUNNING'\)/);
    expect(sql).toMatch(/c\.status = 'PENDING'/);
    expect(sql).toMatch(/c\.leased_until < now\(\)/);
    // Readiness gate: null planned parent OR the sibling parent item is SUCCEEDED
    // (page materialized) — NOT merely codaPageId set (persisted before awaitMutation).
    expect(sql).toMatch(/planned_parent_doc_id IS NULL/);
    expect(sql).toMatch(/p\.status = 'SUCCEEDED'/);
    // Depth-first order + bounded batch.
    expect(sql).toMatch(/ORDER BY c\.job_id, c\.seq/);
    expect(sql).toMatch(/LIMIT/);

    // Params: workerId (string), leasedUntil (Date), batchSize (number).
    expect(typeof params[0]).toBe("string");
    expect(params[1]).toBeInstanceOf(Date);
    expect(params[2]).toBe(5);
    // Lease is in the future.
    expect((params[1] as Date).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("MigrationWorkerService.processItem — create path", () => {
  it("persists codaPageId BEFORE awaitMutation (C3)", async () => {
    const { svc, coda, order } = makeWorker();
    await run(svc, item());

    expect(coda.createPage).toHaveBeenCalledTimes(1);
    const persistIdx = order.seen.indexOf("persist-codaPageId");
    const awaitIdx = order.seen.indexOf("awaitMutation");
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    expect(awaitIdx).toBeGreaterThan(persistIdx);
  });

  it("creates under NO parentPageId for a whole-doc scope root", async () => {
    const { svc, coda } = makeWorker({ scope: { codaDocId: DOC, codaRootPageId: null } });
    await run(svc, item());
    expect((coda.createPage as jest.Mock).mock.calls[0][2].parentPageId).toBeUndefined();
  });

  it("creates under the scope root page for a page-root scope", async () => {
    const { svc, coda } = makeWorker({ scope: { codaDocId: DOC, codaRootPageId: "rootPage" } });
    await run(svc, item());
    expect((coda.createPage as jest.Mock).mock.calls[0][2].parentPageId).toBe("rootPage");
  });

  it("resolves the parent from the sibling item's persisted codaPageId", async () => {
    const { svc, coda, prisma } = makeWorker({ parentCodaPageId: "siblingPage" });
    await run(svc, item({ plannedParentDocId: "parentDoc" }));
    expect(prisma.migrationJobItem.findFirst).toHaveBeenCalledWith({
      where: { jobId: JOB, sourceDocId: "parentDoc" },
      select: { codaPageId: true },
    });
    expect((coda.createPage as jest.Mock).mock.calls[0][2].parentPageId).toBe("siblingPage");
  });

  it("pushes the FROZEN enqueue snapshot verbatim (no run-time re-fetch) (point-in-time, D2)", async () => {
    const { svc, coda } = makeWorker();
    // What the worker pushes is exactly item.snapshotHtml — captured at enqueue — and
    // NOTHING is re-extracted at run (the worker has no rtc dependency at all).
    await run(svc, item({ snapshotHtml: "<p>frozen-at-enqueue</p>", enqueuedSeq: 55 }));
    expect((coda.createPage as jest.Mock).mock.calls[0][2].html).toBe(
      "<p>frozen-at-enqueue</p>",
    );
  });

  it("records migratedSeq (== enqueue seq) and marks the item SUCCEEDED (D1/D2)", async () => {
    const { svc, tx } = makeWorker();
    await run(svc, item({ snapshotHtml: "<p>x</p>", enqueuedSeq: 42 }));
    const finish = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
    expect(finish[0].data.migratedSeq).toBe(42);
    // Guarded on our lease so a steal/cancel can't be double-counted.
    expect(finish[0].where).toMatchObject({ status: "RUNNING", leasedBy: expect.any(String) });
  });

  it("upserts the mapping with the enqueue seq under the advisory lock (D6)", async () => {
    const { svc, tx } = makeWorker();
    await run(svc, item({ snapshotHtml: "<p>x</p>", enqueuedSeq: 9 }));
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.migrationMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceDocId_scopeId: { sourceDocId: "d1", scopeId: SCOPE } },
        create: expect.objectContaining({ codaPageId: "newPage", migratedSeq: 9 }),
      }),
    );
  });
});

describe("MigrationWorkerService.processItem — override path (H3)", () => {
  it("replaces in place, never creates, and keeps the target page id", async () => {
    const { svc, coda, tx } = makeWorker();
    await run(svc, item({ override: true, targetCodaPageId: "targetPage" }));
    expect(coda.replacePageContent).toHaveBeenCalledTimes(1);
    expect(coda.createPage).not.toHaveBeenCalled();
    const persist = (tx.migrationJobItem.update as jest.Mock).mock.calls[0][0];
    expect(persist.data.codaPageId).toBe("targetPage");
  });
});

describe("MigrationWorkerService.processItem — materialization poll (H2)", () => {
  it("polls getPage past 404s until the page materializes, then records its browserLink", async () => {
    const { svc, coda, tx } = makeWorker();
    // 404 → 404 → 200: the page is not queryable/usable-as-parent until Coda
    // finishes materializing it (size-correlated delay).
    (coda.getPageOrNull as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        browserLink: "https://docs.superhuman.com/d/abc/_su9",
      });

    await run(svc, item());

    expect((coda.getPageOrNull as jest.Mock).mock.calls.length).toBe(3);
    // The materialized browserLink (never "") is stored in the mapping.
    const upsert = (tx.migrationMapping.upsert as jest.Mock).mock.calls[0][0];
    expect(upsert.create.codaPageUrl).toBe("https://docs.superhuman.com/d/abc/_su9");
    // Item is marked SUCCEEDED only after materialization.
    const finish = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
  });

  it("never materializes → TRANSIENT release (retryable, no attempt burn), no mapping / empty URL", async () => {
    // Tight budget so the poll gives up quickly.
    const { svc, coda, tx, prisma } = makeWorker();
    (svc as any).materializeTimeoutMs = 20;
    (svc as any).materializePollMs = 5;
    (svc as any).transientBackoffMs = 0;
    (coda.getPageOrNull as jest.Mock).mockResolvedValue(null);

    await run(svc, item({ attempts: 2 }));

    // Threw before the mapping upsert — so no "" URL is ever recorded.
    expect(tx.migrationMapping.upsert).not.toHaveBeenCalled();
    // Not marked SUCCEEDED; released back to PENDING. A page that isn't queryable
    // yet is a self-healing (transient) condition — retry WITHOUT burning an attempt
    // (even one below the cap must not FAIL, else a created-but-slow page → FAILED).
    const finishSucceeded = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finishSucceeded).toBeUndefined();
    const released = (prisma.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "PENDING",
    );
    expect(released).toBeTruthy();
    // Attempt budget is NOT consumed (would be 3 = cap and FAIL if treated permanent).
    expect(released?.[0]?.data).not.toHaveProperty("attempts");
  });

  it("override path never waits: both the pre-replace gate and post-write poll return on the first getPage", async () => {
    const { svc, coda } = makeWorker();
    await run(svc, item({ override: true, targetCodaPageId: "targetPage" }));
    // An existing target ⇒ getPageOrNull returns 200 with no wait, both on the
    // pre-replace materialization gate AND the post-write materialization poll.
    expect((coda.getPageOrNull as jest.Mock).mock.calls.length).toBe(2);
  });
});

describe("MigrationWorkerService.processItem — resume in the create→materialize window (item 58)", () => {
  it("resumes with codaPageId set but not-yet-materialized → polls, then REPLACES (never permanent-fails on the transient 404)", async () => {
    // The crash-resume bug: a page was created + its id persisted (C3) just before a
    // crash, but Coda hasn't materialized it yet. A blind in-place replace would 404
    // (permanent) and FAIL the item; the worker must instead poll until the page is
    // queryable, then replace in place — reusing the SAME page, no permanent fail.
    const { svc, coda, tx, prisma } = makeWorker({ freshCodaPageId: "resumePage" });
    // getPage 404 → 404 → 200: not queryable yet, then materialized (pre-replace gate).
    (coda.getPageOrNull as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ browserLink: "https://docs.superhuman.com/d/x/_su1" });

    await run(svc, item({ codaPageId: "resumePage", attempts: 1 }));

    // No recreate: the resumed page is reused, content re-written in place.
    expect(coda.createPage).not.toHaveBeenCalled();
    expect(coda.replacePageContent).toHaveBeenCalledTimes(1);
    expect((coda.replacePageContent as jest.Mock).mock.calls[0][2]).toBe("resumePage");
    // NOT permanent-failed on the transient not-yet-materialized 404 — SUCCEEDED.
    const failed = (prisma.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "FAILED",
    );
    expect(failed).toBeUndefined();
    const finish = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
    expect(finish[0].data.codaPageId).toBe("resumePage");
  });

  it("a create-item whose reused page never materializes → RECREATES a fresh page (create-item needs a page)", async () => {
    // override=false ⇒ the id came from our OWN prior createPage. If it never becomes
    // queryable (dead/deleted), the id is unusable — recreate a fresh page rather than
    // permanent-failing a doc the user selected to migrate.
    const { svc, coda, tx } = makeWorker({ freshCodaPageId: "deadPage" });
    (svc as any).materializeTimeoutMs = 20;
    (svc as any).materializePollMs = 5;
    // The dead resume id never materializes; the recreated page (id "newPage") does.
    (coda.getPageOrNull as jest.Mock).mockImplementation(
      async (_pool: unknown, _doc: unknown, pageId: string) =>
        pageId === "deadPage"
          ? null
          : { browserLink: "https://docs.superhuman.com/d/x/_suNew" },
    );

    await run(svc, item({ codaPageId: "deadPage" }));

    // Recreated exactly once; the replace was never attempted against the dead id.
    expect(coda.createPage).toHaveBeenCalledTimes(1);
    expect(coda.replacePageContent).not.toHaveBeenCalled();
    // The dead id is overwritten by the fresh one, and the item SUCCEEDS.
    const finish = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
    expect(finish[0].data.codaPageId).toBe("newPage");
  });

  it("an OVERRIDE target that never materializes → PERMANENT fail (user's target is gone; never recreate it)", async () => {
    // override=true ⇒ codaPageId is the user's chosen target. If it never materializes
    // it's genuinely gone — permanent-fail (at the attempt cap) with a clear reason,
    // never a silent recreate under a new id.
    const { svc, coda, tx } = makeWorker();
    (svc as any).materializeTimeoutMs = 20;
    (svc as any).materializePollMs = 5;
    (svc as any).transientBackoffMs = 0;
    (coda.getPageOrNull as jest.Mock).mockResolvedValue(null);

    // attempts=2 → this attempt (3) is the cap, so a permanent error FAILS the item.
    await run(svc, item({ override: true, targetCodaPageId: "goneTarget", attempts: 2 }));

    // Neither a create nor a replace was performed against the gone target.
    expect(coda.createPage).not.toHaveBeenCalled();
    expect(coda.replacePageContent).not.toHaveBeenCalled();
    const failed = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "FAILED",
    );
    expect(failed).toBeTruthy();
    expect(failed[0].data.lastError).toContain("override target page goneTarget not found");
  });
});

describe("MigrationWorkerService.processItem — skip paths (D7/P2)", () => {
  it("skips (never pushes) when the enqueue snapshot was empty (D7)", async () => {
    const { svc, coda, tx } = makeWorker();
    await run(svc, item({ snapshotHtml: null }));
    expect(coda.createPage).not.toHaveBeenCalled();
    const skip = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(skip.data.status).toBe("SKIPPED");
  });

  it("skips when read access was lost / source deleted at run time (P2/D7)", async () => {
    const { svc, coda, tx } = makeWorker({
      assertReadable: jest.fn().mockRejectedValue(new Error("not found")),
    });
    await run(svc, item());
    expect(coda.createPage).not.toHaveBeenCalled();
    expect((tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0].data.status).toBe("SKIPPED");
  });

  it("skips when the job was canceled", async () => {
    const { svc, coda, tx } = makeWorker({
      job: { id: JOB, scopeId: SCOPE, status: "CANCELED", createdById: "u1", startedAt: new Date() },
    });
    await run(svc, item());
    expect(coda.createPage).not.toHaveBeenCalled();
    expect((tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0].data.status).toBe("SKIPPED");
  });

  it("skips when the destination scope was removed (D8)", async () => {
    const { svc, coda, tx } = makeWorker({ scope: null });
    await run(svc, item());
    expect(coda.createPage).not.toHaveBeenCalled();
    expect((tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0].data.status).toBe("SKIPPED");
  });
});

describe("MigrationWorkerService — fault tolerance", () => {
  it("(a/c) reuses an existing page on retry/resume — REPLACES content, never re-creates (C3)", async () => {
    // A prior attempt created the page (codaPageId persisted) then failed — e.g.
    // mid content-write. On retry the worker must re-write into the SAME page (not
    // create a second one) AND must not skip the content write, even though the
    // item's original config was "create new" (override=false, no target link).
    const { svc, coda } = makeWorker({ freshCodaPageId: "existingPage" });
    await run(svc, item({ codaPageId: "existingPage" }));

    expect(coda.createPage).not.toHaveBeenCalled();
    // Content IS (re)written into the existing page (page-id present ⇒ replace).
    expect(coda.replacePageContent).toHaveBeenCalledTimes(1);
    expect((coda.replacePageContent as jest.Mock).mock.calls[0][2]).toBe("existingPage");
    // And its mutation is gated before finishing.
    expect(coda.awaitMutation).toHaveBeenCalled();
  });

  it("(b) claim reclaims an expired lease but skips a fresh one (SQL predicate)", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).claimBatch();
    const sql = ((prisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[]).join("?");
    // A RUNNING item is only re-claimable once its lease is in the past.
    expect(sql).toMatch(/c\.status = 'RUNNING' AND c\.leased_until IS NOT NULL AND c\.leased_until < now\(\)/);
  });
});

describe("MigrationWorkerService.handleItemError — retry-to-max", () => {
  it("releases back to PENDING below the attempt cap", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).handleItemError(item({ attempts: 0 }), new Error("boom"));
    const call = (prisma.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.attempts).toBe(1);
  });

  it("marks FAILED and bumps failedItems at the cap", async () => {
    const { svc, tx } = makeWorker();
    await (svc as any).handleItemError(item({ attempts: 2 }), new Error("boom"));
    const failed = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(failed.data.status).toBe("FAILED");
    expect(failed.data.attempts).toBe(3);
    expect((tx.migrationJob.update as jest.Mock).mock.calls[0][0].data).toEqual({
      failedItems: { increment: 1 },
    });
  });

  it("a TRANSIENT 'rtc-server unreachable' releases to PENDING WITHOUT consuming an attempt", async () => {
    const { svc, prisma } = makeWorker();
    (svc as any).transientBackoffMs = 0; // don't sleep in tests
    // The backend surfaces a downed rtc-server as HttpException({error:"rtc-server unreachable"},502).
    const err = new HttpException({ error: "rtc-server unreachable" }, 502);
    // Even at attempts=2 (one below the cap), a transient error must not fail it.
    await (svc as any).handleItemError(item({ attempts: 2 }), err);
    const call = (prisma.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    // attempts is NOT incremented (would be 3 = cap and FAIL if it were).
    expect(call.data).not.toHaveProperty("attempts");
    expect(call.data.status).not.toBe("FAILED");
  });

  it("Coda 429 (rate limited) and upstream 5xx are transient; a Coda 400 is permanent", async () => {
    const rateLimited = new HttpException({ error: "coda rate limited" }, 429);
    const upstream500 = new HttpException(
      { error: "coda api error", status: 500, body: "boom" },
      502,
    );
    const badRequest = new HttpException(
      { error: "coda api error", status: 400, body: "Invalid parentPageId" },
      502,
    );
    expect(isTransientError(rateLimited)).toBe(true);
    expect(isTransientError(upstream500)).toBe(true);
    expect(isTransientError(badRequest)).toBe(false);
  });

  it("a PERMANENT Coda 400 still FAILS after MAX attempts", async () => {
    const { svc, tx } = makeWorker();
    const err = new HttpException(
      { error: "coda api error", status: 400, body: "Invalid parentPageId" },
      502,
    );
    await (svc as any).handleItemError(item({ attempts: 2 }), err);
    const failed = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(failed.data.status).toBe("FAILED");
    expect(failed.data.attempts).toBe(3);
  });

  it("records a descriptive lastError from a CodaClient HttpException (not 'Http Exception')", async () => {
    const { svc, tx } = makeWorker();
    // CodaClient throws an HttpException whose payload carries status + upstream body.
    const err = new HttpException(
      { error: "coda api error", status: 400, body: "Invalid parentPageId: could not find page" },
      502,
    );
    await (svc as any).handleItemError(item({ attempts: 2 }), err);
    const failed = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(failed.data.status).toBe("FAILED");
    expect(failed.data.lastError).toBe(
      "coda api error 400: Invalid parentPageId: could not find page",
    );
  });
});

describe("MigrationWorkerService.maybeFinalizeJob", () => {
  async function finalize(counts: {
    inFlight?: number;
    failed?: number;
    succeeded?: number;
    orphaned?: number;
    emptySkip?: number;
  }) {
    const { svc, prisma } = makeWorker({ counts });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.migrationJob.updateMany as jest.Mock).mock.calls.at(-1);
    return call?.[0]?.data?.status as string | undefined;
  }

  it("does not finalize while items are still in flight", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 2 } });
    await (svc as any).maybeFinalizeJob(JOB);
    expect(prisma.migrationJob.updateMany).not.toHaveBeenCalled();
  });

  it("all succeeded → SUCCEEDED", async () => {
    expect(await finalize({ inFlight: 0, failed: 0, succeeded: 3 })).toBe("SUCCEEDED");
  });

  it("some succeeded + some failed → PARTIAL", async () => {
    expect(await finalize({ inFlight: 0, failed: 1, succeeded: 2 })).toBe("PARTIAL");
  });

  it("all failed → FAILED", async () => {
    expect(await finalize({ inFlight: 0, failed: 3, succeeded: 0 })).toBe("FAILED");
  });

  it("a 'parent did not migrate' orphan skip → PARTIAL, never SUCCEEDED", async () => {
    // All non-skipped items succeeded, but an orphaned descendant was cascade-skipped
    // — it must not hide under a green SUCCEEDED job.
    expect(
      await finalize({ inFlight: 0, failed: 0, succeeded: 2, orphaned: 1 }),
    ).toBe("PARTIAL");
  });

  it("clean empty-source skips do not taint SUCCEEDED", async () => {
    expect(
      await finalize({ inFlight: 0, failed: 0, succeeded: 2, emptySkip: 2 }),
    ).toBe("SUCCEEDED");
  });

  it("a tainting skip (unreadable/dest-removed source) keeps a job off SUCCEEDED → PARTIAL", async () => {
    // A SELECTED doc that couldn't be migrated (not merely empty) must surface: with
    // other successes it's PARTIAL, never a green SUCCEEDED hiding an unmigrated doc.
    expect(
      await finalize({ inFlight: 0, failed: 0, succeeded: 2, orphaned: 1 }),
    ).toBe("PARTIAL");
  });

  it("a tainting skip with zero successes → FAILED (nothing migrated)", async () => {
    expect(
      await finalize({ inFlight: 0, failed: 0, succeeded: 0, orphaned: 1 }),
    ).toBe("FAILED");
  });

  it("guards the transition on QUEUED/RUNNING so CANCELED is never clobbered", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 0, failed: 0, succeeded: 1 } });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.migrationJob.updateMany as jest.Mock).mock.calls.at(-1)[0];
    expect(call.where).toMatchObject({ id: JOB, status: { in: ["QUEUED", "RUNNING"] } });
  });
});

describe("MigrationWorkerService — terminal-parent cascade (no deadlock)", () => {
  it("cascade-skips PENDING descendants of a terminal parent and bumps skippedItems per job", async () => {
    const { svc, prisma } = makeWorker();
    // The recursive-CTE UPDATE returns one row per item it flipped to SKIPPED.
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { jobId: JOB },
      { jobId: JOB },
      { jobId: "job2" },
    ]);

    const jobIds = await (svc as any).skipOrphansOfTerminalParents();

    const sql = ((prisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/WITH RECURSIVE/i);
    expect(sql).toMatch(/status = 'SKIPPED'/);
    expect(sql).toMatch(/last_error = 'parent did not migrate'/);
    // Seeded from PENDING children whose parent item is terminally FAILED/SKIPPED.
    expect(sql).toMatch(/p\.status IN \('FAILED', 'SKIPPED'\)/);
    // Per-job skippedItems incremented by the number of rows cascaded in that job.
    expect(prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: JOB },
      data: { skippedItems: { increment: 2 } },
    });
    expect(prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "job2" },
      data: { skippedItems: { increment: 1 } },
    });
    expect([...jobIds].sort()).toEqual([JOB, "job2"].sort());
  });

  it("does nothing (no counter bump, no jobIds) when no items are blocked", async () => {
    const { svc, prisma } = makeWorker();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);
    const jobIds = await (svc as any).skipOrphansOfTerminalParents();
    expect(jobIds).toEqual([]);
    expect(prisma.migrationJob.update).not.toHaveBeenCalled();
  });

  it("tick does not deadlock: cascades a blocked subtree, then finalizes the job", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 0, failed: 1, succeeded: 0 } });
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([]) // claimBatch: nothing claimable (child blocked on FAILED parent)
      .mockResolvedValueOnce([{ jobId: JOB }]) // cascade: the blocked child → SKIPPED
      .mockResolvedValue([]); // then nothing left to claim or cascade

    await (svc as any).tick();

    // With the blocked child now SKIPPED, no PENDING/RUNNING remain → job finalizes.
    const finalize = (prisma.migrationJob.updateMany as jest.Mock).mock.calls.at(-1)?.[0];
    expect(finalize).toBeTruthy();
    expect(finalize.data.status).toBe("FAILED");
    expect(finalize.where).toMatchObject({ id: JOB, status: { in: ["QUEUED", "RUNNING"] } });
  });
});

describe("chunkHtmlByBytes (H8)", () => {
  it("returns a single chunk when within budget", () => {
    expect(chunkHtmlByBytes("<p>small</p>", 80_000)).toEqual(["<p>small</p>"]);
  });

  it("splits oversized HTML on top-level element boundaries, each within budget", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<p>block ${i} ${"x".repeat(50)}</p>`).join("");
    const chunks = chunkHtmlByBytes(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Rejoining is lossless, and no chunk splits an element (balanced <p>…</p>).
    expect(chunks.join("")).toBe(html);
    for (const c of chunks) {
      const opens = (c.match(/<p>/g) ?? []).length;
      const closes = (c.match(/<\/p>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it("emits a single oversized element alone rather than tearing it", () => {
    const big = `<p>${"y".repeat(500)}</p>`;
    const chunks = chunkHtmlByBytes(big + "<p>tail</p>", 100);
    expect(chunks[0]).toBe(big);
  });
});
