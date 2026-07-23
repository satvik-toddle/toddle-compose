import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import type { DocumentsService } from "../documents/documents.service";
import type { CodaClient } from "../coda/coda.client";
import type { RtcContentClient } from "../rtc/rtc-content.client";
import type { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { CodaImportCredentialsService } from "./coda-import-credentials.service";
import type { TokenCipher } from "../migration/token-cipher";
import {
  CodaImportWorkerService,
  orderDepthFirst,
  isTransientError,
  PARENT_SKIP_REASON,
} from "./coda-import-worker.service";

const JOB = "job1";
const WS = "ws1";
const CODA_DOC = "cdoc1";

// A claimed READY item (already flipped to RUNNING under our lease).
function item(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "it1",
    jobId: JOB,
    codaPageId: "page1",
    codaPageName: "Page One",
    codaPageUrl: "https://coda.io/d/_dcdoc1/Page-One_su1",
    plannedParentCodaPageId: null,
    createdDocId: null,
    attempts: 0,
    transientAttempts: 0,
    seq: 0,
    ...over,
  } as any;
}

function makeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    IMPORT_WORKER_INTERVAL_MS: 15_000,
    IMPORT_LEASE_TTL_MS: 300_000,
    IMPORT_BATCH_SIZE: 4,
    IMPORT_MAX_ITEM_ATTEMPTS: 3,
    IMPORT_MAX_TRANSIENT_ATTEMPTS: 5,
    INTERNAL_TOKEN: "secret",
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService<Env, true>;
}

interface Order {
  push: (label: string) => void;
  seen: string[];
}

function makeWorker(over?: {
  job?: any;
  user?: any;
  parentCreatedDocId?: string | null;
  leaseGuard?: { status: string; leasedBy: string | null };
  persistCount?: number;
  createdDoc?: { id: string };
  counts?: {
    inFlight?: number;
    failed?: number;
    succeeded?: number;
    skipped?: number;
  };
}) {
  const order: Order = { seen: [], push(l) { this.seen.push(l); } };

  const job =
    over?.job === undefined
      ? {
          id: JOB,
          status: "RUNNING",
          createdById: "u1",
          targetWorkspaceId: WS,
          codaDocId: CODA_DOC,
          codaRootPageId: null,
          codaDocUrl: "https://coda.io/d/_dcdoc1",
          credentialId: null,
          startedAt: new Date(),
          // Fully planned by default so maybeFinalizeJob proceeds; a planning-in-flight
          // test overrides this to false.
          planningComplete: true,
        }
      : over.job;

  const counts = over?.counts ?? {};

  // Tracks reverse-linkage scope creation across ensureImportScope calls (idempotency).
  let scopeCreateCount = 0;

  // Interactive-tx surface shared by finishItem / failItem / planJob / ensureImportScope.
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: JOB, startedAt: null }]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    migrationScope: {
      // First create returns a fresh id; a second ensureImportScope must reuse it.
      findFirst: jest.fn(async () =>
        scopeCreateCount > 0 ? { id: "scope1" } : null,
      ),
      create: jest.fn(async () => {
        scopeCreateCount += 1;
        order.push("scope-create");
        return { id: "scope1" };
      }),
    },
    codaImportJobItem: {
      createMany: jest.fn(async (arg: any) => {
        order.push("createMany");
        return { count: arg?.data?.length ?? 0 };
      }),
      updateMany: jest.fn(async (arg: any) => {
        if (arg?.data?.status === "SUCCEEDED") order.push("finish-succeeded");
        return { count: over?.persistCount ?? 1 };
      }),
    },
    codaImportJob: {
      // finishItem's increment update selects the fresh counts; return sensible
      // values so the follow-up progressMessage write reads real numbers.
      update: jest.fn(async (arg: any) =>
        arg?.select
          ? { totalItems: 3, succeededItems: 1, failedItems: 0, skippedItems: 0 }
          : {},
      ),
    },
  };

  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
    ),
    codaImportJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    // Durable milestone timeline: a separate-row INSERT per milestone (never a JSON blob).
    codaImportJobEvent: {
      create: jest.fn(async (arg: any) => {
        order.push(`event:${arg?.data?.message}`);
        return { id: "ev1" };
      }),
    },
    codaImportJobItem: {
      findFirst: jest.fn().mockResolvedValue({
        createdDocId: over?.parentCreatedDocId ?? "parentDoc",
      }),
      // Incremental whole-doc planning creates items via the non-tx client.
      createMany: jest.fn(async (arg: any) => {
        order.push("prisma-createMany");
        return { count: arg?.data?.length ?? 0 };
      }),
      // stillLeased re-read; default to this worker's own RUNNING lease (set below).
      findUnique: jest.fn(),
      updateMany: jest.fn(async (arg: any) => {
        if (arg?.data?.createdDocId && !arg?.data?.status) order.push("persist");
        if (arg?.data?.status === "PENDING") order.push("release");
        return { count: over?.persistCount ?? 1 };
      }),
      count: jest.fn(async (arg: any) => {
        const w = arg?.where ?? {};
        if (w.status && typeof w.status === "object" && Array.isArray(w.status.in)) {
          return counts.inFlight ?? 0;
        }
        if (w.status === "FAILED") return counts.failed ?? 0;
        if (w.status === "SUCCEEDED") return counts.succeeded ?? 1;
        if (w.status === "SKIPPED") return counts.skipped ?? 0;
        return 0;
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(
        over?.user ?? {
          id: "u1",
          email: "u1@x.com",
          name: "User One",
          color: "#fff",
        },
      ),
    },
    // Reverse Copy-to-Coda linkage surface: unlocked fast-path scope lookup + mapping upsert.
    migrationScope: {
      findFirst: jest.fn(async () =>
        scopeCreateCount > 0 ? { id: "scope1" } : null,
      ),
    },
    migrationMapping: {
      upsert: jest.fn(async () => {
        order.push("mapping-upsert");
        return {};
      }),
    },
  } as unknown as PrismaService;

  const documents = {
    create: jest.fn(async () => {
      order.push("create-doc");
      return over?.createdDoc ?? { id: "doc1" };
    }),
  } as unknown as DocumentsService;

  const coda = {
    listPages: jest.fn().mockResolvedValue([]),
    exportPage: jest.fn(async () => {
      order.push("export");
      return "<p>hello</p>";
    }),
    // ensureImportScope reads the source name (+ the root page's parent) when creating the scope.
    getDoc: jest.fn().mockResolvedValue({ id: CODA_DOC, name: "Source Doc" }),
    getPage: jest.fn().mockResolvedValue({ id: "root", name: "Satvik", parent: { id: "parentPage" } }),
  } as unknown as CodaClient;

  const rtcContent = {
    replaceHtml: jest.fn(async () => {
      order.push("replaceHtml");
      return 1;
    }),
  } as unknown as RtcContentClient;

  const rtcInternal = {
    initDocBestEffort: jest.fn(async () => {
      order.push("initDoc");
    }),
  } as unknown as RtcInternalClient;

  const credentials = {
    getTokenPool: jest.fn().mockResolvedValue(["tokA"]),
    getToken: jest.fn().mockResolvedValue("tokA"),
  } as unknown as CodaImportCredentialsService;

  const cipher = {
    encrypt: jest.fn((plain: string) => `enc(${plain})`),
    decrypt: jest.fn((enc: string) => enc),
  } as unknown as TokenCipher;

  const svc = new CodaImportWorkerService(
    prisma,
    makeConfig(),
    documents,
    coda,
    rtcContent,
    rtcInternal,
    credentials,
    cipher,
  );
  (prisma.codaImportJobItem.findUnique as jest.Mock).mockResolvedValue(
    over?.leaseGuard ?? { status: "RUNNING", leasedBy: (svc as any).workerId },
  );

  return { svc, prisma, tx, documents, coda, rtcContent, rtcInternal, credentials, cipher, order };
}

function run(svc: CodaImportWorkerService, it: any): Promise<void> {
  return (svc as any).processItem(it);
}

describe("orderDepthFirst (page tree → depth-first items)", () => {
  it("orders parents before children and stamps each child's parent page id", () => {
    const pages = [
      { id: "c1", name: "Child", parent: { id: "p1" } },
      { id: "p1", name: "Parent" },
      { id: "gc1", name: "Grandchild", parent: { id: "c1" } },
      { id: "top2", name: "Second Top" },
    ];
    const out = orderDepthFirst(pages);
    const ids = out.map((o) => o.codaPageId);
    // Parent precedes its descendants; the depth-first subtree stays contiguous.
    expect(ids.indexOf("p1")).toBeLessThan(ids.indexOf("c1"));
    expect(ids.indexOf("c1")).toBeLessThan(ids.indexOf("gc1"));
    const byId = new Map(out.map((o) => [o.codaPageId, o]));
    expect(byId.get("p1")!.plannedParentCodaPageId).toBeNull();
    expect(byId.get("c1")!.plannedParentCodaPageId).toBe("p1");
    expect(byId.get("gc1")!.plannedParentCodaPageId).toBe("c1");
    expect(byId.get("top2")!.plannedParentCodaPageId).toBeNull();
    // Every page is planned exactly once.
    expect(out.length).toBe(4);
  });

  it("treats a parent ref outside the doc's page set as top-level (no orphan drop)", () => {
    const pages = [{ id: "a", name: "A", parent: { id: "ghost" } }];
    const out = orderDepthFirst(pages);
    expect(out).toEqual([
      { codaPageId: "a", codaPageName: "A", codaPageUrl: null, plannedParentCodaPageId: null },
    ]);
  });

  it("page-root: includes the root as a top-level doc and nests its subtree under it", () => {
    // Root "Satvik" has 4 sub-pages; one child has a grandchild. An unrelated
    // top-level page and its child must NOT be imported (only the root + its subtree).
    const pages = [
      { id: "root", name: "Satvik" },
      { id: "c1", name: "Child 1", parent: { id: "root" } },
      { id: "c2", name: "Child 2", parent: { id: "root" } },
      { id: "c3", name: "Child 3", parent: { id: "root" } },
      { id: "c4", name: "Child 4", parent: { id: "root" } },
      { id: "gc1", name: "Grandchild", parent: { id: "c1" } },
      { id: "other", name: "Unrelated" },
      { id: "otherChild", name: "Unrelated child", parent: { id: "other" } },
    ];
    const out = orderDepthFirst(pages, "root");
    const ids = out.map((o) => o.codaPageId);
    // The root page IS imported (as a top-level doc); unrelated pages are excluded.
    expect(ids).not.toContain("other");
    expect(ids).not.toContain("otherChild");
    // The root plus its 5 descendants. (Sort a COPY — ids stays in document order for
    // the seq-ordering checks below.)
    expect([...ids].sort()).toEqual(["c1", "c2", "c3", "c4", "gc1", "root"].sort());
    const byId = new Map(out.map((o) => [o.codaPageId, o]));
    // The root page is top-level; its direct children nest under it (not promoted).
    expect(byId.get("root")!.plannedParentCodaPageId).toBeNull();
    expect(byId.get("c1")!.plannedParentCodaPageId).toBe("root");
    expect(byId.get("c4")!.plannedParentCodaPageId).toBe("root");
    // Deeper nesting is preserved against the intermediate item.
    expect(byId.get("gc1")!.plannedParentCodaPageId).toBe("c1");
    // A parent still precedes its child in seq order.
    expect(ids.indexOf("root")).toBeLessThan(ids.indexOf("c1"));
    expect(ids.indexOf("c1")).toBeLessThan(ids.indexOf("gc1"));
  });

  it("page-root with no descendants → just the root page as one top-level doc", () => {
    const pages = [
      { id: "root", name: "Leaf" },
      { id: "other", name: "Unrelated" },
    ];
    expect(orderDepthFirst(pages, "root")).toEqual([
      { codaPageId: "root", codaPageName: "Leaf", codaPageUrl: null, plannedParentCodaPageId: null },
    ]);
  });
});

describe("CodaImportWorkerService.planJob", () => {
  it("whole-doc: creates items PER listPages batch (skipDuplicates), then flips planningComplete", async () => {
    const { svc, coda, prisma } = makeWorker();
    // Two batches arrive via the onBatch callback (4th arg) as pages paginate.
    (coda.listPages as jest.Mock).mockImplementation(
      async (_pool: string[], _doc: string, _onProgress: any, onBatch: any) => {
        await onBatch?.(
          [{ id: "p1", name: "Parent", browserLink: "https://coda.io/d/_dcdoc1/Parent_su1" }],
          1,
        );
        await onBatch?.([{ id: "c1", name: "Child", parent: { id: "p1" } }], 2);
        return [];
      },
    );

    await (svc as any).planJob(JOB, CODA_DOC, null);

    // One createMany PER batch, each idempotent (skipDuplicates on @@unique).
    const createCalls = (prisma.codaImportJobItem.createMany as jest.Mock).mock.calls;
    expect(createCalls).toHaveLength(2);
    // Each page keeps its REAL Coda parent id (null only when it has none); seq runs
    // across batches; browserLink captured (null when Coda omits it).
    expect(createCalls[0][0]).toEqual({
      data: [
        { jobId: JOB, codaPageId: "p1", codaPageName: "Parent", codaPageUrl: "https://coda.io/d/_dcdoc1/Parent_su1", plannedParentCodaPageId: null, seq: 0 },
      ],
      skipDuplicates: true,
    });
    expect(createCalls[1][0]).toEqual({
      data: [
        { jobId: JOB, codaPageId: "c1", codaPageName: "Child", codaPageUrl: null, plannedParentCodaPageId: "p1", seq: 1 },
      ],
      skipDuplicates: true,
    });
    // totalItems is bumped by the rows actually inserted, per batch.
    const increments = (prisma.codaImportJob.update as jest.Mock).mock.calls
      .map((c) => c[0]?.data?.totalItems?.increment)
      .filter((n): n is number => typeof n === "number");
    expect(increments).toEqual([1, 1]);
    // Planning is closed out only after the last batch: planningComplete → true.
    const complete = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.planningComplete === true,
    );
    expect(complete).toBeTruthy();
  });

  it("whole-doc: stops planning when the job is canceled between batches", async () => {
    const { svc, coda, prisma } = makeWorker();
    // The between-batch status re-read reports CANCELED → stop before the 2nd batch.
    (prisma.codaImportJob.findUnique as jest.Mock).mockResolvedValue({ status: "CANCELED" });
    (coda.listPages as jest.Mock).mockImplementation(
      async (_pool: string[], _doc: string, _onProgress: any, onBatch: any) => {
        await onBatch?.([{ id: "p1", name: "P1" }], 1);
        await onBatch?.([{ id: "p2", name: "P2" }], 2);
        return [];
      },
    );

    await (svc as any).planJob(JOB, CODA_DOC, null);

    // Only the first batch was created; planning never completed.
    expect(prisma.codaImportJobItem.createMany as jest.Mock).toHaveBeenCalledTimes(1);
    const complete = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.planningComplete === true,
    );
    expect(complete).toBeFalsy();
  });

  it("page-root: root page + subtree in ONE createMany (skipDuplicates), then planningComplete", async () => {
    const { svc, coda, tx, prisma } = makeWorker();
    (coda.listPages as jest.Mock).mockResolvedValue([
      { id: "root", name: "Satvik" },
      { id: "c1", name: "Child 1", parent: { id: "root" } },
      { id: "c2", name: "Child 2", parent: { id: "root" } },
      { id: "gc1", name: "Grandchild", parent: { id: "c1" } },
      { id: "other", name: "Unrelated" },
    ]);

    await (svc as any).planJob(JOB, CODA_DOC, "root");

    // The subtree needs the full tree to scope, so it's planned in ONE createMany.
    expect(tx.codaImportJobItem.createMany).toHaveBeenCalledTimes(1);
    const call = (tx.codaImportJobItem.createMany as jest.Mock).mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    const created = call.data;
    const ids = created.map((c: any) => c.codaPageId);
    // Root IS an item (top-level doc); unrelated page excluded.
    expect(ids).not.toContain("other");
    expect(ids.sort()).toEqual(["c1", "c2", "gc1", "root"].sort());
    const byId = new Map<string, any>(created.map((c: any) => [c.codaPageId, c]));
    // The root is top-level (null parent); its children nest under it; grandchild deeper.
    expect(byId.get("root").plannedParentCodaPageId).toBeNull();
    expect(byId.get("c1").plannedParentCodaPageId).toBe("root");
    expect(byId.get("c2").plannedParentCodaPageId).toBe("root");
    expect(byId.get("gc1").plannedParentCodaPageId).toBe("c1");
    // seq is contiguous depth-first (parent before child).
    expect(byId.get("root").seq).toBeLessThan(byId.get("c1").seq);
    expect(byId.get("c1").seq).toBeLessThan(byId.get("gc1").seq);
    // totalItems bumped by inserted count; planningComplete flipped after.
    expect((tx.codaImportJob.update as jest.Mock).mock.calls[0][0].data).toEqual({
      totalItems: { increment: 4 },
    });
    const complete = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.planningComplete === true,
    );
    expect(complete).toBeTruthy();
  });

  it("defers (does not plan) when no Coda token is configured", async () => {
    const { svc, coda, credentials } = makeWorker();
    (credentials.getTokenPool as jest.Mock).mockResolvedValue([]);
    await (svc as any).planJob(JOB, CODA_DOC, null);
    expect(coda.listPages).not.toHaveBeenCalled();
  });
});

describe("CodaImportWorkerService — live progress reporting", () => {
  // The progressMessage from every prisma.codaImportJob.updateMany call, in order.
  function progressWrites(prisma: PrismaService): string[] {
    return (prisma.codaImportJob.updateMany as jest.Mock).mock.calls
      .map((c) => c[0]?.data?.progressMessage)
      .filter((m): m is string => typeof m === "string");
  }

  it("planJob flips QUEUED→RUNNING up front and (whole-doc) closes on an 'Importing documents…' line", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).planJob(JOB, CODA_DOC, null);

    // Status flip is guarded on QUEUED (idempotent; never clobbers CANCELED) and does
    // NOT stamp startedAt here (completePlanning stamps it after the last batch).
    const flip = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.status === "RUNNING",
    );
    expect(flip[0].where).toEqual({ id: JOB, status: "QUEUED" });
    expect(flip[0].data).not.toHaveProperty("startedAt");

    const msgs = progressWrites(prisma);
    expect(msgs).toContain("Fetching pages from Coda…");
    // Whole-doc closes planning with the import-phase activity line.
    expect(msgs).toContain("Importing documents…");
  });

  it("whole-doc planJob writes a throttled 'Fetching pages… (N)' as batches arrive", async () => {
    const { svc, prisma, coda } = makeWorker();
    (coda.listPages as jest.Mock).mockImplementation(
      async (_pool: string[], _doc: string, _onProgress: any, onBatch: any) => {
        await onBatch?.([{ id: "p1", name: "P1" }], 42);
        return [];
      },
    );
    await (svc as any).planJob(JOB, CODA_DOC, null);
    expect(progressWrites(prisma)).toContain("Fetching pages from Coda… (42)");
  });

  it("a successful item sets an 'Importing documents… (done/total)' progress message from fresh counts", async () => {
    const { svc, tx } = makeWorker();
    await run(svc, item());
    const progressCall = (tx.codaImportJob.update as jest.Mock).mock.calls.find(
      (c) => typeof c[0]?.data?.progressMessage === "string",
    );
    expect(progressCall[0].data.progressMessage).toBe("Importing documents… (1/3)");
  });

  it("maybeFinalizeJob clears the progress message (null) on the terminal transition", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 0, failed: 0, succeeded: 2 } });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.at(-1)[0];
    expect(call.data.progressMessage).toBeNull();
  });
});

describe("CodaImportWorkerService — milestone timeline (logEvent)", () => {
  // Every message passed to codaImportJobEvent.create, in call order.
  function eventMessages(prisma: PrismaService): string[] {
    return (prisma.codaImportJobEvent.create as jest.Mock).mock.calls.map(
      (c) => c[0]?.data?.message,
    );
  }

  it("whole-doc planJob logs plan-start, a per-batch 'Fetched N pages', 'Found N…', then 'Importing documents…'", async () => {
    const { svc, coda, prisma } = makeWorker();
    (coda.listPages as jest.Mock).mockImplementation(
      async (_pool: string[], _doc: string, _onProgress: any, onBatch: any) => {
        await onBatch?.([{ id: "p1", name: "Parent" }], 1);
        await onBatch?.([{ id: "c1", name: "Child", parent: { id: "p1" } }], 2);
        return [];
      },
    );

    await (svc as any).planJob(JOB, CODA_DOC, null);

    const msgs = eventMessages(prisma);
    expect(msgs[0]).toBe("Fetching pages from Coda…");
    expect(msgs).toContain("Fetched 1 pages");
    expect(msgs).toContain("Fetched 2 pages");
    // "Found N…" precedes "Importing documents…" so the timeline reads in order.
    const foundIdx = msgs.indexOf("Found 2 page(s) — creating documents");
    const importingIdx = msgs.indexOf("Importing documents…");
    expect(foundIdx).toBeGreaterThanOrEqual(0);
    expect(importingIdx).toBeGreaterThan(foundIdx);
  });

  it("page-root planJob logs plan-start, 'Planned N document(s)', then 'Importing documents…'", async () => {
    const { svc, coda, prisma } = makeWorker();
    (coda.listPages as jest.Mock).mockResolvedValue([
      { id: "root", name: "Root" },
      { id: "c1", name: "Child", parent: { id: "root" } },
    ]);

    await (svc as any).planJob(JOB, CODA_DOC, "root");

    const msgs = eventMessages(prisma);
    expect(msgs[0]).toBe("Fetching pages from Coda…");
    const plannedIdx = msgs.indexOf("Planned 2 document(s)");
    const importingIdx = msgs.indexOf("Importing documents…");
    expect(plannedIdx).toBeGreaterThanOrEqual(0);
    expect(importingIdx).toBeGreaterThan(plannedIdx);
  });

  it("logs 'Importing documents…' only on the false→true planningComplete transition (once per job)", async () => {
    const { svc, prisma } = makeWorker();
    // The guarded flip matches 0 rows (already planned) → no duplicate milestone.
    (prisma.codaImportJob.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await (svc as any).completePlanning(JOB);
    expect(eventMessages(prisma)).not.toContain("Importing documents…");
  });

  it("maybeFinalizeJob logs an 'Import completed — …' milestone on a successful finalize", async () => {
    const { svc, prisma } = makeWorker({
      counts: { inFlight: 0, failed: 0, succeeded: 3, skipped: 0 },
    });
    await (svc as any).maybeFinalizeJob(JOB);
    expect(eventMessages(prisma)).toContain(
      "Import completed — 3 succeeded, 0 failed, 0 skipped",
    );
  });

  it("maybeFinalizeJob logs 'Import failed — …' when nothing imported and something failed", async () => {
    const { svc, prisma } = makeWorker({
      counts: { inFlight: 0, failed: 2, succeeded: 0, skipped: 0 },
    });
    await (svc as any).maybeFinalizeJob(JOB);
    expect(eventMessages(prisma)).toContain(
      "Import failed — 0 succeeded, 2 failed, 0 skipped",
    );
  });
});

describe("CodaImportWorkerService.claimBatch (lease/claim SQL + parent gate)", () => {
  it("emits an atomic UPDATE with SKIP LOCKED, lease reclaim, and the createdDocId parent gate", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).claimBatch();

    const call = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    const sql = (call[0] as string[]).join("?");

    expect(sql).toMatch(/UPDATE coda_import_job_items/i);
    expect(sql).toMatch(/status = 'RUNNING'/);
    expect(sql).toMatch(/FOR UPDATE OF c SKIP LOCKED/);
    expect(sql).toMatch(/j\.status IN \(\?\)/);
    expect(sql).toMatch(/c\.status = 'PENDING'/);
    expect(sql).toMatch(/c\.leased_until < now\(\)/);
    // Parent gate: top-level OR the sibling parent item already has a created doc.
    expect(sql).toMatch(/planned_parent_coda_page_id IS NULL/);
    expect(sql).toMatch(/p\.created_doc_id IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY c\.job_id, c\.seq/);
  });
});

describe("CodaImportWorkerService.processItem — create path", () => {
  it("creates the doc and persists createdDocId BEFORE the content write (idempotency)", async () => {
    const { svc, documents, order } = makeWorker();
    await run(svc, item());

    expect(documents.create).toHaveBeenCalledTimes(1);
    const persistIdx = order.seen.indexOf("persist");
    const writeIdx = order.seen.indexOf("replaceHtml");
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(persistIdx);
  });

  it("creates a top-level page under the workspace root (parentId undefined)", async () => {
    const { svc, documents } = makeWorker();
    await run(svc, item({ plannedParentCodaPageId: null }));
    const arg = (documents.create as jest.Mock).mock.calls[0];
    expect(arg[1]).toMatchObject({ workspaceId: WS, title: "Page One", type: "DOC" });
    expect(arg[1].parentId).toBeUndefined();
  });

  it("resolves the parent doc from the sibling item's createdDocId and nests under it", async () => {
    const { svc, documents, prisma } = makeWorker({ parentCreatedDocId: "parentDoc9" });
    await run(svc, item({ plannedParentCodaPageId: "parentPage" }));
    expect(prisma.codaImportJobItem.findFirst).toHaveBeenCalledWith({
      where: { jobId: JOB, codaPageId: "parentPage" },
      select: { createdDocId: true },
    });
    expect((documents.create as jest.Mock).mock.calls[0][1].parentId).toBe("parentDoc9");
  });

  it("exports the Coda page, sanitizes it, and writes the body via rtc", async () => {
    const { svc, coda, rtcContent } = makeWorker();
    await run(svc, item());
    expect(coda.exportPage).toHaveBeenCalledWith(["tokA"], CODA_DOC, "page1");
    // The sanitized <p>hello</p> is written (sanitizer keeps it verbatim).
    expect((rtcContent.replaceHtml as jest.Mock).mock.calls[0][1]).toBe("<p>hello</p>");
  });

  it("marks the item SUCCEEDED and bumps succeededItems", async () => {
    const { svc, tx } = makeWorker();
    await run(svc, item());
    const finish = (tx.codaImportJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
    expect(finish[0].where).toMatchObject({ status: "RUNNING", leasedBy: expect.any(String) });
    expect((tx.codaImportJob.update as jest.Mock).mock.calls[0][0].data).toEqual({
      succeededItems: { increment: 1 },
    });
  });
});

describe("CodaImportWorkerService — reverse Copy-to-Coda linkage", () => {
  it("ensureImportScope creates ONE scope pointing back at the source doc, encrypting its token", async () => {
    const { svc, cipher } = makeWorker();
    const job = {
      targetWorkspaceId: WS,
      codaDocId: CODA_DOC,
      codaRootPageId: null,
      codaDocUrl: "https://coda.io/d/_dcdoc1",
      credentialId: null,
      createdById: "u1",
    };
    const scopeId = await (svc as any).ensureImportScope(job);
    expect(scopeId).toBe("scope1");
    // The per-scope token is encrypted (never stored plaintext).
    expect(cipher.encrypt).toHaveBeenCalledWith("tokA");
  });

  it("ensureImportScope is idempotent: a second call reuses the existing scope (no second create)", async () => {
    const { svc, tx } = makeWorker();
    const job = {
      targetWorkspaceId: WS,
      codaDocId: CODA_DOC,
      codaRootPageId: null,
      codaDocUrl: "https://coda.io/d/_dcdoc1",
      credentialId: null,
      createdById: "u1",
    };
    const first = await (svc as any).ensureImportScope(job);
    const second = await (svc as any).ensureImportScope(job);
    expect(first).toBe("scope1");
    expect(second).toBe("scope1");
    // Exactly one scope was ever created.
    expect((tx.migrationScope.create as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it("ensureImportScope creates the scope + token in ONE tx under an advisory lock", async () => {
    const { svc, tx } = makeWorker();
    const job = {
      targetWorkspaceId: WS,
      codaDocId: CODA_DOC,
      codaRootPageId: null,
      codaDocUrl: "https://coda.io/d/_dcdoc1",
      credentialId: null,
      createdById: "u1",
    };
    await (svc as any).ensureImportScope(job);
    // The advisory lock is taken before the guarded re-check + create.
    expect(tx.$executeRaw).toHaveBeenCalled();
    const createArg = (tx.migrationScope.create as jest.Mock).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      workspaceId: WS,
      // Whole-doc import (job.codaRootPageId null) → whole-doc scope + doc-name label.
      codaDocId: CODA_DOC,
      codaRootPageId: null,
      codaRootUrl: "https://coda.io/d/_dcdoc1",
      label: "Imported from Coda: Source Doc",
      createdById: "u1",
    });
    const token = createArg.data.tokens.create[0];
    expect(token.codaTokenEnc).toBe("enc(tokA)");
    expect(token.codaTokenHint).toBe("tokA".slice(-4));
  });

  it("page-root scope roots at the imported page ITSELF (subtree-constrained round-trip) + names the label after the page", async () => {
    // getPage mock: root page "Satvik" (its Coda parent is ignored for the scope root).
    const { svc, tx } = makeWorker({
      job: {
        id: JOB, status: "RUNNING", createdById: "u1", targetWorkspaceId: WS,
        codaDocId: CODA_DOC, codaRootPageId: "root", codaDocUrl: "https://coda.io/d/_dcdoc1",
        credentialId: null, startedAt: new Date(),
      },
    });
    await (svc as any).ensureImportScope({
      targetWorkspaceId: WS, codaDocId: CODA_DOC, codaRootPageId: "root",
      codaDocUrl: "https://coda.io/d/_dcdoc1", credentialId: null, createdById: "u1",
    });
    const createArg = (tx.migrationScope.create as jest.Mock).mock.calls[0][0];
    // Scope root = the imported page itself, so copy-back nests under it; label carries the page name.
    expect(createArg.data.codaRootPageId).toBe("root");
    expect(createArg.data.label).toBe("Imported from Coda: Satvik");
  });

  it("ensureImportScope returns null when there is no target workspace", async () => {
    const { svc } = makeWorker();
    const scopeId = await (svc as any).ensureImportScope({
      targetWorkspaceId: null,
      codaDocId: CODA_DOC,
      codaRootPageId: null,
      codaDocUrl: "u",
      credentialId: null,
      createdById: "u1",
    });
    expect(scopeId).toBeNull();
  });

  it("a successful item upserts a MigrationMapping (imported doc → origin Coda page URL)", async () => {
    const { svc, prisma } = makeWorker();
    await run(svc, item());
    const upsert = (prisma as any).migrationMapping.upsert as jest.Mock;
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      sourceDocId_scopeId: { sourceDocId: "doc1", scopeId: "scope1" },
    });
    expect(arg.create).toMatchObject({
      sourceDocId: "doc1",
      scopeId: "scope1",
      codaPageId: "page1",
      codaPageUrl: "https://coda.io/d/_dcdoc1/Page-One_su1",
      migratedSeq: 0,
    });
    expect(arg.update).toMatchObject({
      codaPageId: "page1",
      codaPageUrl: "https://coda.io/d/_dcdoc1/Page-One_su1",
    });
  });

  it("a linkage failure does NOT fail the import item (content already landed)", async () => {
    const { svc, prisma, tx } = makeWorker();
    (tx.migrationScope.create as jest.Mock).mockRejectedValueOnce(new Error("db down"));
    (prisma as any).migrationScope.findFirst = jest.fn().mockResolvedValue(null);
    await run(svc, item());
    // The item still reaches SUCCEEDED despite the linkage throwing.
    const finish = (tx.codaImportJobItem.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data.status === "SUCCEEDED",
    );
    expect(finish).toBeTruthy();
  });
});

describe("CodaImportWorkerService.processItem — idempotent resume", () => {
  it("reuses an existing createdDocId — never creates a second doc — and re-writes content", async () => {
    const { svc, documents, rtcContent } = makeWorker();
    await run(svc, item({ createdDocId: "resumeDoc" }));
    expect(documents.create).not.toHaveBeenCalled();
    // Content is (re)written into the SAME doc.
    expect((rtcContent.replaceHtml as jest.Mock).mock.calls[0][0]).toBe("resumeDoc");
  });
});

describe("CodaImportWorkerService.processItem — skip / abort paths", () => {
  it("skips when the job was canceled", async () => {
    const { svc, documents, tx } = makeWorker({
      job: { id: JOB, status: "CANCELED", createdById: "u1", targetWorkspaceId: WS, codaDocId: CODA_DOC },
    });
    await run(svc, item());
    expect(documents.create).not.toHaveBeenCalled();
    expect((tx.codaImportJobItem.updateMany as jest.Mock).mock.calls[0][0].data.status).toBe("SKIPPED");
  });

  it("aborts before creating when the item is no longer leased (concurrent terminate)", async () => {
    const { svc, documents } = makeWorker({ leaseGuard: { status: "SKIPPED", leasedBy: null } });
    await run(svc, item());
    expect(documents.create).not.toHaveBeenCalled();
  });

  it("aborts if the guarded createdDocId persist matches 0 rows (item terminated after create)", async () => {
    const { svc, documents, rtcContent } = makeWorker({ persistCount: 0 });
    await run(svc, item());
    expect(documents.create).toHaveBeenCalledTimes(1);
    // Never proceeds to the content write.
    expect(rtcContent.replaceHtml).not.toHaveBeenCalled();
  });
});

describe("CodaImportWorkerService.handleItemError — retry split", () => {
  it("releases to PENDING below the permanent cap", async () => {
    const { svc, prisma } = makeWorker();
    await (svc as any).handleItemError(item({ attempts: 0 }), new Error("boom"), "export");
    const call = (prisma.codaImportJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.attempts).toBe(1);
  });

  it("FAILS at the permanent cap and bumps failedItems", async () => {
    const { svc, tx } = makeWorker();
    await (svc as any).handleItemError(item({ attempts: 2 }), new Error("boom"), "write-content");
    const failed = (tx.codaImportJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(failed.data.status).toBe("FAILED");
    expect(failed.data.attempts).toBe(3);
    expect((tx.codaImportJob.update as jest.Mock).mock.calls[0][0].data).toEqual({
      failedItems: { increment: 1 },
    });
  });

  it("a TRANSIENT error bumps ONLY the transient budget and rides past the permanent cap", async () => {
    const { svc, prisma } = makeWorker();
    (svc as any).transientBackoffMs = 0;
    const err = new HttpException({ error: "rtc-server unreachable" }, 502);
    await (svc as any).handleItemError(item({ attempts: 2, transientAttempts: 0 }), err);
    const call = (prisma.codaImportJobItem.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.attempts).toBe(2);
    expect(call.data.transientAttempts).toBe(1);
  });

  it("classifies unreachable / rate-limited / export-timeout / 5xx as transient; 4xx as permanent", () => {
    expect(isTransientError(new HttpException({ error: "coda unreachable" }, 502))).toBe(true);
    expect(isTransientError(new HttpException({ error: "coda rate limited" }, 429))).toBe(true);
    expect(isTransientError(new HttpException({ error: "coda export timed out" }, 504))).toBe(true);
    expect(
      isTransientError(new HttpException({ error: "coda api error", status: 500, body: "x" }, 502)),
    ).toBe(true);
    expect(
      isTransientError(new HttpException({ error: "coda api error", status: 404, body: "gone" }, 502)),
    ).toBe(false);
  });
});

describe("CodaImportWorkerService.maybeFinalizeJob", () => {
  async function finalize(counts: {
    inFlight?: number;
    failed?: number;
    succeeded?: number;
    skipped?: number;
  }) {
    const { svc, prisma } = makeWorker({ counts });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.at(-1);
    return call?.[0]?.data?.status as string | undefined;
  }

  it("does not finalize while items are still in flight", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 2 } });
    await (svc as any).maybeFinalizeJob(JOB);
    expect(prisma.codaImportJob.updateMany).not.toHaveBeenCalled();
  });

  it("returns early (never finalizes) while the job is still being planned", async () => {
    // planningComplete=false: a whole-doc import may still create more items, so a
    // momentary "no in-flight items" must NOT be read as done.
    const { svc, prisma } = makeWorker({
      job: { id: JOB, status: "RUNNING", planningComplete: false },
      counts: { inFlight: 0, failed: 0, succeeded: 0 },
    });
    await (svc as any).maybeFinalizeJob(JOB);
    expect(prisma.codaImportJob.updateMany).not.toHaveBeenCalled();
  });

  it("all imported → SUCCEEDED", async () => {
    expect(await finalize({ inFlight: 0, failed: 0, succeeded: 3 })).toBe("SUCCEEDED");
  });

  it("a 0-page doc (nothing to import) → SUCCEEDED", async () => {
    expect(await finalize({ inFlight: 0, failed: 0, succeeded: 0, skipped: 0 })).toBe("SUCCEEDED");
  });

  it("some imported + some failed → PARTIAL", async () => {
    expect(await finalize({ inFlight: 0, failed: 1, succeeded: 2 })).toBe("PARTIAL");
  });

  it("a tainting skip keeps a job off SUCCEEDED → PARTIAL", async () => {
    expect(await finalize({ inFlight: 0, failed: 0, succeeded: 2, skipped: 1 })).toBe("PARTIAL");
  });

  it("nothing imported and something failed → FAILED", async () => {
    expect(await finalize({ inFlight: 0, failed: 3, succeeded: 0 })).toBe("FAILED");
  });

  it("guards the transition on QUEUED/RUNNING so CANCELED is never clobbered", async () => {
    const { svc, prisma } = makeWorker({ counts: { inFlight: 0, failed: 0, succeeded: 1 } });
    await (svc as any).maybeFinalizeJob(JOB);
    const call = (prisma.codaImportJob.updateMany as jest.Mock).mock.calls.at(-1)[0];
    expect(call.where).toMatchObject({ id: JOB, status: { in: ["QUEUED", "RUNNING"] } });
  });
});

describe("CodaImportWorkerService.skipOrphansOfTerminalParents", () => {
  it("cascade-skips PENDING descendants of a terminal parent and bumps skippedItems per job", async () => {
    const { svc, prisma } = makeWorker();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { jobId: JOB },
      { jobId: JOB },
      { jobId: "job2" },
    ]);

    const jobIds = await (svc as any).skipOrphansOfTerminalParents();

    const sql = ((prisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/WITH RECURSIVE/i);
    expect(sql).toMatch(/status = 'SKIPPED'/);
    expect(sql).toMatch(/p\.status IN \('FAILED', 'SKIPPED'\)/);
    // Only fully-planned jobs are considered (a not-yet-listed parent isn't an orphan).
    expect(sql).toMatch(/j\.planning_complete = true/);
    expect(prisma.codaImportJob.update).toHaveBeenCalledWith({
      where: { id: JOB },
      data: { skippedItems: { increment: 2 } },
    });
    expect([...jobIds].sort()).toEqual([JOB, "job2"].sort());
  });

  it("exposes the parent-skip reason literal used in the cascade SQL", () => {
    expect(PARENT_SKIP_REASON).toBe("parent page did not import");
  });
});
