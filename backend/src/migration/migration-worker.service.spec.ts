import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import type { DocumentsService } from "../documents/documents.service";
import type { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { CodaClient } from "../coda/coda.client";
import type { CodaCredentialsService } from "./coda-credentials.service";
import {
  MigrationWorkerService,
  chunkHtmlByBytes,
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
    enqueuedSeq: null,
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
  content?: { html: string; headSeq: number; isEmpty: boolean };
  assertReadable?: jest.Mock;
  counts?: { inFlight?: number; failed?: number; succeeded?: number };
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

  const content = over?.content ?? { html: "<p>hi</p>", headSeq: 7, isEmpty: false };

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
  let countCall = 0;
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
    ),
    migrationJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    migrationScope: { findFirst: jest.fn().mockResolvedValue(scope) },
    migrationMapping: { upsert: jest.fn() },
    migrationJobItem: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ codaPageId: over?.parentCodaPageId ?? "parentPage" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn(async () => {
        // Called order in maybeFinalizeJob: inFlight, then failed, then succeeded.
        const seq = [counts.inFlight ?? 0, counts.failed ?? 0, counts.succeeded ?? 1];
        return seq[Math.min(countCall++, seq.length - 1)];
      }),
    },
  } as unknown as PrismaService;

  const documents = {
    assertReadable:
      over?.assertReadable ??
      jest.fn().mockResolvedValue({ workspaceId: "w1", type: "DOC" }),
  } as unknown as DocumentsService;

  const rtc = {
    getCodaHtml: jest.fn().mockResolvedValue({ docId: "d1", ...content }),
  } as unknown as RtcInternalClient;

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
  } as unknown as CodaClient;

  const credentials = {
    getTokenPool: jest.fn().mockResolvedValue(["tokA", "tokB"]),
  } as unknown as CodaCredentialsService;

  const svc = new MigrationWorkerService(
    prisma,
    makeConfig(),
    documents,
    rtc,
    coda,
    credentials,
  );

  return { svc, prisma, tx, documents, rtc, coda, credentials, order };
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
    // Readiness gate: null planned parent OR the sibling parent already has codaPageId.
    expect(sql).toMatch(/planned_parent_doc_id IS NULL/);
    expect(sql).toMatch(/p\.coda_page_id IS NOT NULL/);
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

  it("fetches the point-in-time snapshot at enqueuedSeq (falls back to latest when null)", async () => {
    const a = makeWorker();
    await run(a.svc, item({ enqueuedSeq: 55 }));
    expect(a.rtc.getCodaHtml).toHaveBeenCalledWith("d1", 55);

    const b = makeWorker();
    await run(b.svc, item({ enqueuedSeq: null }));
    expect(b.rtc.getCodaHtml).toHaveBeenCalledWith("d1", undefined);
  });

  it("records migratedSeq (head seq) and marks the item SUCCEEDED (D1/D2)", async () => {
    const { svc, tx } = makeWorker({ content: { html: "<p>x</p>", headSeq: 42, isEmpty: false } });
    await run(svc, item());
    const finish = (tx.migrationJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
    expect(finish[0].data.migratedSeq).toBe(42);
    // Guarded on our lease so a steal/cancel can't be double-counted.
    expect(finish[0].where).toMatchObject({ status: "RUNNING", leasedBy: expect.any(String) });
  });

  it("upserts the mapping with headSeq under the advisory lock (D6)", async () => {
    const { svc, tx } = makeWorker({ content: { html: "<p>x</p>", headSeq: 9, isEmpty: false } });
    await run(svc, item());
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

describe("MigrationWorkerService.processItem — skip paths (D7/P2)", () => {
  it("skips (never pushes) when the source is empty (D7)", async () => {
    const { svc, coda, tx } = makeWorker({ content: { html: "", headSeq: 3, isEmpty: true } });
    await run(svc, item());
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
  it("(a/c) does NOT re-create a page when codaPageId is already set — idempotent resume (C3)", async () => {
    // Simulate a crash AFTER createPage persisted codaPageId, BEFORE awaitMutation:
    // on resume the fresh row already carries the page id.
    const { svc, coda } = makeWorker({ freshCodaPageId: "existingPage" });
    await run(svc, item({ codaPageId: "existingPage" }));
    expect(coda.createPage).not.toHaveBeenCalled();
    // No requestId → no second gate/append; the item still completes.
    expect(coda.awaitMutation).not.toHaveBeenCalled();
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
});

describe("MigrationWorkerService.maybeFinalizeJob", () => {
  async function finalize(counts: { inFlight?: number; failed?: number; succeeded?: number }) {
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

  it("guards the transition on QUEUED/RUNNING so CANCELED is never clobbered", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 0, failed: 0, succeeded: 1 } });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.migrationJob.updateMany as jest.Mock).mock.calls.at(-1)[0];
    expect(call.where).toMatchObject({ id: JOB, status: { in: ["QUEUED", "RUNNING"] } });
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
