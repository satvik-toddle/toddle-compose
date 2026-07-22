import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthzService } from "../realm/authz.service";
import type { ActiveRealmService } from "../realm/active-realm.service";
import type { DocumentsService } from "../documents/documents.service";
import type { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { ScopeValidationService } from "./scope-validation.service";
import { MigrationJobsService } from "./migration-jobs.service";
import { EnqueueMigrationJobDto } from "./dto";

const USER = "u1";
const WS = "w1";
const SCOPE = "s1";

// A minimal two-node plan (root + one child) unless overridden.
function plan(overrides?: Partial<EnqueueMigrationJobDto>): EnqueueMigrationJobDto {
  return {
    items: [
      { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
      {
        sourceDocId: "child",
        plannedParentDocId: "root",
        title: "Child",
        include: true,
      },
    ],
    ...overrides,
  } as EnqueueMigrationJobDto;
}

function makeService(opts?: {
  scope?: { id: string; workspaceId: string } | null;
  requireWorkspaceRole?: jest.Mock;
  requireRealmRole?: jest.Mock;
  assertReadable?: jest.Mock;
  validateDestinationUrl?: jest.Mock;
  getCodaHtml?: jest.Mock;
  txExecuteRaw?: jest.Mock;
  txJobFindFirst?: jest.Mock;
  txJobCreate?: jest.Mock;
  jobFindMany?: jest.Mock;
  jobFindUnique?: jest.Mock;
  txItemFindMany?: jest.Mock;
  txItemUpdateMany?: jest.Mock;
  txJobUpdate?: jest.Mock;
  mappingFindMany?: jest.Mock;
  documentFindFirst?: jest.Mock;
}) {
  const scope =
    opts?.scope === undefined ? { id: SCOPE, workspaceId: WS } : opts.scope;

  const tx = {
    $executeRaw: opts?.txExecuteRaw ?? jest.fn().mockResolvedValue(1),
    migrationJob: {
      findFirst: opts?.txJobFindFirst ?? jest.fn().mockResolvedValue(null),
      create:
        opts?.txJobCreate ?? jest.fn().mockResolvedValue({ id: "job1" }),
      update: opts?.txJobUpdate ?? jest.fn(async ({ data }: any) => ({ ...jobRow(), ...data })),
    },
    migrationJobItem: {
      findMany:
        opts?.txItemFindMany ?? jest.fn().mockResolvedValue([]),
      updateMany:
        opts?.txItemUpdateMany ?? jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const prisma = {
    migrationScope: { findFirst: jest.fn().mockResolvedValue(scope) },
    migrationJob: {
      findMany: opts?.jobFindMany ?? jest.fn().mockResolvedValue([]),
      findUnique: opts?.jobFindUnique ?? jest.fn().mockResolvedValue(null),
    },
    migrationMapping: {
      findMany: opts?.mappingFindMany ?? jest.fn().mockResolvedValue([]),
    },
    document: {
      findUnique:
        opts?.documentFindFirst ??
        jest.fn().mockResolvedValue({ workspaceId: WS }),
    },
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
    ),
  } as unknown as PrismaService;

  const authz = {
    requireWorkspaceRole:
      opts?.requireWorkspaceRole ?? jest.fn().mockResolvedValue("EDIT"),
    requireRealmRole:
      opts?.requireRealmRole ?? jest.fn().mockResolvedValue("MAINTAINER"),
  } as unknown as AuthzService;

  const realm = { id: "r1" } as unknown as ActiveRealmService;

  const documents = {
    assertReadable:
      opts?.assertReadable ??
      jest.fn().mockResolvedValue({ workspaceId: WS, type: "DOC" }),
  } as unknown as DocumentsService;

  const scopeValidation = {
    validateDestinationUrl:
      opts?.validateDestinationUrl ??
      jest.fn().mockResolvedValue({ codaPageId: "cp1" }),
  } as unknown as ScopeValidationService;

  const rtc = {
    getCodaHtml:
      opts?.getCodaHtml ??
      jest
        .fn()
        .mockResolvedValue({ docId: "d", html: "<p>x</p>", headSeq: 0, isEmpty: false }),
  } as unknown as RtcInternalClient;

  return {
    svc: new MigrationJobsService(
      prisma,
      authz,
      realm,
      documents,
      scopeValidation,
      rtc,
    ),
    prisma,
    authz,
    documents,
    scopeValidation,
    rtc,
    tx,
  };
}

function jobRow(over?: Partial<Record<string, unknown>>) {
  return {
    id: "job1",
    workspaceId: WS,
    scopeId: SCOPE,
    sourceRootDocId: "root",
    status: "QUEUED",
    totalItems: 2,
    succeededItems: 0,
    failedItems: 0,
    skippedItems: 0,
    error: null,
    createdById: USER,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

describe("MigrationJobsService.enqueue", () => {
  it("rejects a viewer / grant-only guest (workspace EDIT gate, P8b)", async () => {
    const { svc } = makeService({
      requireWorkspaceRole: jest
        .fn()
        .mockRejectedValue(new ForbiddenException()),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("404s an unknown/deleted scope", async () => {
    const { svc } = makeService({ scope: null });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects when an included doc is a SHEET (DOC-only)", async () => {
    const { svc } = makeService({
      assertReadable: jest
        .fn()
        .mockResolvedValue({ workspaceId: WS, type: "SHEET" }),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      /SHEET/,
    );
  });

  it("rejects when an included doc is unreadable", async () => {
    const { svc } = makeService({
      assertReadable: jest
        .fn()
        .mockRejectedValue(new NotFoundException("document not found")),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects a doc in a different workspace than the scope", async () => {
    const { svc } = makeService({
      assertReadable: jest
        .fn()
        .mockResolvedValue({ workspaceId: "other", type: "DOC" }),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      /workspace/,
    );
  });

  it("rejects an out-of-scope override URL and names the row", async () => {
    const { svc } = makeService({
      validateDestinationUrl: jest
        .fn()
        .mockRejectedValue(new BadRequestException("not within the scope root")),
    });
    const p = plan({
      items: [
        {
          sourceDocId: "root",
          plannedParentDocId: null,
          title: "Root",
          destinationUrl: "https://coda.io/d/x/canvas-bad",
          include: true,
        },
      ],
    } as any);
    await expect(svc.enqueue(USER, SCOPE, p)).rejects.toThrow(/root/);
  });

  it("rejects a double-submit (non-terminal job for the same scope+root, #17)", async () => {
    const { svc } = makeService({
      txJobFindFirst: jest.fn().mockResolvedValue({ id: "existing" }),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      /already queued or running/,
    );
  });

  it("drops include:false rows before enqueue", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    const p = plan({
      items: [
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
        { sourceDocId: "skip", plannedParentDocId: "root", title: "Skip", include: false },
      ],
    } as any);
    await svc.enqueue(USER, SCOPE, p);
    const data = create.mock.calls[0][0].data;
    expect(data.totalItems).toBe(1);
    expect(data.items.create).toHaveLength(1);
    expect(data.items.create[0].sourceDocId).toBe("root");
  });

  it("creates the job + items in a transaction (happy path, depth-first seq)", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc, prisma, scopeValidation } = makeService({ txJobCreate: create });
    const p = plan({
      items: [
        {
          sourceDocId: "child",
          plannedParentDocId: "root",
          title: "Child",
          destinationUrl: "https://coda.io/d/x/canvas-ok",
          include: true,
        },
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
      ],
    } as any);
    const res = await svc.enqueue(USER, SCOPE, p);
    expect(res).toEqual({ jobId: "job1" });
    expect((prisma.$transaction as jest.Mock)).toHaveBeenCalledTimes(1);

    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe("QUEUED");
    expect(data.workspaceId).toBe(WS);
    expect(data.sourceRootDocId).toBe("root");
    expect(data.createdById).toBe(USER);
    expect(data.totalItems).toBe(2);
    // Root sorts first despite being listed second; child carries the override target.
    const created = data.items.create;
    expect(created.map((i: any) => i.sourceDocId)).toEqual(["root", "child"]);
    expect(created.map((i: any) => i.seq)).toEqual([0, 1]);
    const childItem = created.find((i: any) => i.sourceDocId === "child");
    expect(childItem.override).toBe(true);
    expect(childItem.targetCodaPageId).toBe("cp1");
    const rootItem = created.find((i: any) => i.sourceDocId === "root");
    expect(rootItem.override).toBe(false);
    expect(rootItem.targetCodaPageId).toBeNull();
    expect(scopeValidation.validateDestinationUrl).toHaveBeenCalledTimes(1);
  });

  it("FREEZES each doc's HTML at enqueue (snapshotHtml + enqueuedSeq) from rtc.getCodaHtml", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const getCodaHtml = jest.fn().mockImplementation((id: string) =>
      Promise.resolve(
        id === "root"
          ? { docId: id, html: "<p>ROOT snapshot</p>", headSeq: 10, isEmpty: false }
          : { docId: id, html: "<p>CHILD snapshot</p>", headSeq: 20, isEmpty: false },
      ),
    );
    const { svc, rtc } = makeService({ txJobCreate: create, getCodaHtml });
    await svc.enqueue(USER, SCOPE, plan());
    // Captured with NO atSeq — the CURRENT (Start-Copy) version, frozen verbatim.
    expect(rtc.getCodaHtml).toHaveBeenCalledWith("root");
    expect(rtc.getCodaHtml).toHaveBeenCalledWith("child");
    const created = create.mock.calls[0][0].data.items.create;
    const root = created.find((i: any) => i.sourceDocId === "root");
    const child = created.find((i: any) => i.sourceDocId === "child");
    expect(root.snapshotHtml).toBe("<p>ROOT snapshot</p>");
    expect(root.enqueuedSeq).toBe(10);
    expect(child.snapshotHtml).toBe("<p>CHILD snapshot</p>");
    expect(child.enqueuedSeq).toBe(20);
  });

  it("stores snapshotHtml=null for a doc that is empty at enqueue (skipped at run, D7)", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const getCodaHtml = jest
      .fn()
      .mockResolvedValue({ docId: "d", html: "", headSeq: 3, isEmpty: true });
    const { svc } = makeService({ txJobCreate: create, getCodaHtml });
    await svc.enqueue(USER, SCOPE, plan());
    const created = create.mock.calls[0][0].data.items.create;
    for (const it of created) {
      expect(it.snapshotHtml).toBeNull();
      // The seq is still recorded for the audit trail even when the doc is empty.
      expect(it.enqueuedSeq).toBe(3);
    }
  });

  it("point-in-time: a LATER edit cannot change what was frozen at enqueue", async () => {
    // The snapshot is captured (and stored) at enqueue; whatever getCodaHtml would
    // return afterward is irrelevant — the worker later pushes the stored snapshotHtml,
    // never re-reading. Here we assert enqueue persisted the value read AT enqueue time.
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const getCodaHtml = jest
      .fn()
      .mockResolvedValue({ docId: "d", html: "<p>v1 at enqueue</p>", headSeq: 5, isEmpty: false });
    const { svc } = makeService({ txJobCreate: create, getCodaHtml });
    await svc.enqueue(USER, SCOPE, plan());
    const created = create.mock.calls[0][0].data.items.create;
    // A subsequent edit would advance the doc, but the persisted snapshot is v1.
    getCodaHtml.mockResolvedValue({ docId: "d", html: "<p>v2 after edit</p>", headSeq: 6, isEmpty: false });
    for (const it of created) {
      expect(it.snapshotHtml).toBe("<p>v1 at enqueue</p>");
    }
  });

  it("fails closed (no job created) when the content extraction throws", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({
      txJobCreate: create,
      getCodaHtml: jest.fn().mockRejectedValue(new Error("rtc unreachable")),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      /content snapshot/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("takes the (scope, root) advisory lock BEFORE the double-submit guard read (#17 race)", async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const findFirst = jest.fn().mockResolvedValue(null);
    const { svc } = makeService({
      txExecuteRaw: executeRaw,
      txJobFindFirst: findFirst,
    });
    await svc.enqueue(USER, SCOPE, plan());
    // The advisory lock must be issued before the guard read so two concurrent
    // enqueues serialize and the loser sees the winner's job (no duplicate subtree).
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findFirst.mock.invocationCallOrder[0],
    );
  });

  it("re-parents a kept child whose mid-tree parent was UNchecked to the grandparent (fix)", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    // root → mid (excluded) → leaf (kept). leaf must re-parent to root, not dangle on mid.
    const p = plan({
      items: [
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
        { sourceDocId: "mid", plannedParentDocId: "root", title: "Mid", include: false },
        { sourceDocId: "leaf", plannedParentDocId: "mid", title: "Leaf", include: true },
      ],
    } as any);
    await svc.enqueue(USER, SCOPE, p);
    const created = create.mock.calls[0][0].data.items.create;
    expect(created.map((i: any) => i.sourceDocId).sort()).toEqual(["leaf", "root"]);
    const leaf = created.find((i: any) => i.sourceDocId === "leaf");
    // mid is not an included item → leaf hangs off root (the nearest included ancestor).
    expect(leaf.plannedParentDocId).toBe("root");
  });

  it("re-parents across MULTIPLE excluded ancestors to the nearest included one", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    // root → a → b(excluded) → c(excluded) → d(kept). d re-parents up to `a`.
    const p = plan({
      items: [
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
        { sourceDocId: "a", plannedParentDocId: "root", title: "A", include: true },
        { sourceDocId: "b", plannedParentDocId: "a", title: "B", include: false },
        { sourceDocId: "c", plannedParentDocId: "b", title: "C", include: false },
        { sourceDocId: "d", plannedParentDocId: "c", title: "D", include: true },
      ],
    } as any);
    await svc.enqueue(USER, SCOPE, p);
    const created = create.mock.calls[0][0].data.items.create;
    const d = created.find((i: any) => i.sourceDocId === "d");
    expect(d.plannedParentDocId).toBe("a");
    // A kept child of an included parent is left untouched.
    const a = created.find((i: any) => i.sourceDocId === "a");
    expect(a.plannedParentDocId).toBe("root");
  });

  it("rejects an A↔B parent cycle among included items (400, never a wedge)", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    // root is the true root; a→b and b→a form a cycle both reparenting leaves intact.
    const p = plan({
      items: [
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
        { sourceDocId: "a", plannedParentDocId: "b", title: "A", include: true },
        { sourceDocId: "b", plannedParentDocId: "a", title: "B", include: true },
      ],
    } as any);
    await expect(svc.enqueue(USER, SCOPE, p)).rejects.toThrow(/parent cycle/);
    expect(create).not.toHaveBeenCalled();
  });

  it("normalizes an explicit root row's stale non-null planned parent to null", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    // Direct-API payload: the explicit root carries a leftover parent id that has no
    // item row — it must be normalized to null, else the root can never be claimed.
    const p = plan({
      sourceRootDocId: "root",
      items: [
        { sourceDocId: "root", plannedParentDocId: "ghost", title: "Root", include: true },
        { sourceDocId: "child", plannedParentDocId: "root", title: "Child", include: true },
      ],
    } as any);
    await svc.enqueue(USER, SCOPE, p);
    const created = create.mock.calls[0][0].data.items.create;
    const root = created.find((i: any) => i.sourceDocId === "root");
    expect(root.plannedParentDocId).toBeNull();
  });

  it("re-anchors a self-loop (excluded-chain parent resolving to itself) to the root", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({ txJobCreate: create });
    // leaf → ex(excluded) → leaf: nearestIncluded resolves back to leaf itself, which
    // must be treated as not-found and re-anchored to root (never leaf-of-itself).
    const p = plan({
      items: [
        { sourceDocId: "root", plannedParentDocId: null, title: "Root", include: true },
        { sourceDocId: "leaf", plannedParentDocId: "ex", title: "Leaf", include: true },
        { sourceDocId: "ex", plannedParentDocId: "leaf", title: "Ex", include: false },
      ],
    } as any);
    await svc.enqueue(USER, SCOPE, p);
    const created = create.mock.calls[0][0].data.items.create;
    const leaf = created.find((i: any) => i.sourceDocId === "leaf");
    expect(leaf.plannedParentDocId).toBe("root");
  });
});

describe("MigrationJobsService.validateDestination (per-row link check)", () => {
  it("returns {ok:true, codaPageId} for a valid URL", async () => {
    const { svc } = makeService({
      validateDestinationUrl: jest.fn().mockResolvedValue({ codaPageId: "cp9" }),
    });
    const res = await svc.validateDestination(USER, SCOPE, "https://coda.io/d/x/canvas-ok");
    expect(res).toEqual({ ok: true, codaPageId: "cp9" });
  });

  it("returns {ok:false, reason} (does NOT throw) when validation rejects", async () => {
    const { svc } = makeService({
      validateDestinationUrl: jest
        .fn()
        .mockRejectedValue(new BadRequestException("not within the scope root")),
    });
    const res = await svc.validateDestination(USER, SCOPE, "https://coda.io/d/x/canvas-bad");
    expect(res).toEqual({ ok: false, reason: "not within the scope root" });
  });

  it("404s an unknown/deleted scope", async () => {
    const { svc } = makeService({ scope: null });
    await expect(
      svc.validateDestination(USER, SCOPE, "https://coda.io/d/x/canvas"),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws for a non-member / insufficient role (workspace EDIT gate)", async () => {
    const requireWorkspaceRole = jest
      .fn()
      .mockRejectedValue(new ForbiddenException());
    const { svc } = makeService({ requireWorkspaceRole });
    await expect(
      svc.validateDestination(USER, SCOPE, "https://coda.io/d/x/canvas"),
    ).rejects.toThrow(ForbiddenException);
    expect(requireWorkspaceRole).toHaveBeenCalledWith(USER, WS, "EDIT");
  });
});

describe("MigrationJobsService.skipItemsForDeletedDocs (delete hook, D7)", () => {
  it("flips claimable items to SKIPPED, bumps per-job skippedItems, returns affected jobIds", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: "i1", jobId: "jobA" },
      { id: "i2", jobId: "jobA" },
      { id: "i3", jobId: "jobB" },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const jobUpdate = jest.fn().mockResolvedValue({});
    const { svc, tx } = makeService({
      txItemFindMany: findMany,
      txItemUpdateMany: updateMany,
      txJobUpdate: jobUpdate,
    });
    const jobIds = await svc.skipItemsForDeletedDocs(tx as any, ["d1", "d2"]);

    // Only still-claimable items are flipped to SKIPPED.
    expect(findMany.mock.calls[0][0].where.status.in).toEqual(["PENDING", "RUNNING"]);
    expect(updateMany.mock.calls[0][0].data.status).toBe("SKIPPED");
    // Each job's skippedItems bumped by the number of its items flipped.
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "jobA" },
      data: { skippedItems: { increment: 2 } },
    });
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "jobB" },
      data: { skippedItems: { increment: 1 } },
    });
    expect([...jobIds].sort()).toEqual(["jobA", "jobB"]);
  });

  it("no-ops (no update, no jobIds) when nothing is claimable", async () => {
    const updateMany = jest.fn();
    const { svc, tx } = makeService({
      txItemFindMany: jest.fn().mockResolvedValue([]),
      txItemUpdateMany: updateMany,
    });
    const jobIds = await svc.skipItemsForDeletedDocs(tx as any, ["d1"]);
    expect(jobIds).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns [] for an empty docIds list without touching the db", async () => {
    const findMany = jest.fn();
    const { svc, tx } = makeService({ txItemFindMany: findMany });
    const jobIds = await svc.skipItemsForDeletedDocs(tx as any, []);
    expect(jobIds).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("MigrationJobsService.listMappings (modal prefill)", () => {
  it("404s an unknown/deleted scope", async () => {
    const { svc } = makeService({ scope: null });
    await expect(svc.listMappings(USER, SCOPE, ["d1"])).rejects.toThrow(
      NotFoundException,
    );
  });

  it("requires workspace EDIT+ on the scope's workspace (same gate as enqueue)", async () => {
    const requireWorkspaceRole = jest
      .fn()
      .mockRejectedValue(new ForbiddenException());
    const { svc } = makeService({ requireWorkspaceRole });
    await expect(svc.listMappings(USER, SCOPE, ["d1"])).rejects.toThrow(
      ForbiddenException,
    );
    expect(requireWorkspaceRole).toHaveBeenCalledWith(USER, WS, "EDIT");
  });

  it("returns [] without querying when no docIds are given", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = makeService({ mappingFindMany: findMany });
    const res = await svc.listMappings(USER, SCOPE, []);
    expect(res).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns only mapped docs for the scope, projected to the prefill view", async () => {
    const now = new Date();
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "m1",
        sourceDocId: "d1",
        scopeId: SCOPE,
        codaPageId: "cp1",
        codaPageUrl: "https://coda.io/d/x/canvas-1",
        migratedSeq: 42,
        lastMigratedAt: now,
      },
    ]);
    const { svc } = makeService({ mappingFindMany: findMany });
    const res = await svc.listMappings(USER, SCOPE, ["d1", "d2"]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      scopeId: SCOPE,
      sourceDocId: { in: ["d1", "d2"] },
    });
    expect(res).toEqual([
      {
        sourceDocId: "d1",
        codaPageId: "cp1",
        codaPageUrl: "https://coda.io/d/x/canvas-1",
        migratedSeq: 42,
        lastMigratedAt: now,
      },
    ]);
  });
});

describe("MigrationJobsService.listDocCodaMappings (Open in Coda)", () => {
  it("404s an unknown/deleted document", async () => {
    const { svc } = makeService({
      documentFindFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.listDocCodaMappings(USER, "d1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("requires workspace EDIT+ on the doc's workspace (same gate as Copy-to-Coda)", async () => {
    const requireWorkspaceRole = jest
      .fn()
      .mockRejectedValue(new ForbiddenException());
    const { svc } = makeService({ requireWorkspaceRole });
    await expect(svc.listDocCodaMappings(USER, "d1")).rejects.toThrow(
      ForbiddenException,
    );
    expect(requireWorkspaceRole).toHaveBeenCalledWith(USER, WS, "EDIT");
  });

  it("queries only non-deleted in-workspace scopes and projects the scope label", async () => {
    const now = new Date();
    const findMany = jest.fn().mockResolvedValue([
      {
        sourceDocId: "d1",
        codaPageUrl: "https://coda.io/d/x/canvas-1",
        lastMigratedAt: now,
        scope: { id: "s1", label: "Marketing Coda" },
      },
      {
        sourceDocId: "d1",
        codaPageUrl: "https://coda.io/d/y/canvas-2",
        lastMigratedAt: now,
        scope: { id: "s2", label: "Engineering Coda" },
      },
    ]);
    const { svc } = makeService({ mappingFindMany: findMany });
    const res = await svc.listDocCodaMappings(USER, "d1");
    expect(findMany.mock.calls[0][0].where).toEqual({
      sourceDocId: "d1",
      scope: { workspaceId: WS, deletedAt: null },
    });
    expect(res).toEqual([
      {
        codaPageUrl: "https://coda.io/d/x/canvas-1",
        scopeId: "s1",
        scopeLabel: "Marketing Coda",
        lastMigratedAt: now,
      },
      {
        codaPageUrl: "https://coda.io/d/y/canvas-2",
        scopeId: "s2",
        scopeLabel: "Engineering Coda",
        lastMigratedAt: now,
      },
    ]);
  });

  it("returns [] when the doc has no Coda mappings", async () => {
    const { svc } = makeService({
      mappingFindMany: jest.fn().mockResolvedValue([]),
    });
    await expect(svc.listDocCodaMappings(USER, "d1")).resolves.toEqual([]);
  });
});

describe("MigrationJobsService.list (visibility, P6)", () => {
  it("workspace listing requires EDIT+ and scopes non-admins to their own runs", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const requireWorkspaceRole = jest.fn().mockResolvedValue("EDIT");
    const { svc } = makeService({ requireWorkspaceRole, jobFindMany: findMany });
    await svc.list(USER, WS);
    expect(requireWorkspaceRole).toHaveBeenCalledWith(USER, WS, "EDIT");
    expect(findMany.mock.calls[0][0].where).toEqual({
      workspaceId: WS,
      createdById: USER,
    });
  });

  it("a workspace ADMIN sees all the workspace's runs", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = makeService({
      requireWorkspaceRole: jest.fn().mockResolvedValue("ADMIN"),
      jobFindMany: findMany,
    });
    await svc.list(USER, WS);
    expect(findMany.mock.calls[0][0].where).toEqual({ workspaceId: WS });
  });

  it("the org-wide listing (no workspaceId) requires realm admin", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const requireRealmRole = jest.fn().mockResolvedValue("MAINTAINER");
    const { svc } = makeService({ requireRealmRole, jobFindMany: findMany });
    await svc.list(USER, undefined);
    expect(requireRealmRole).toHaveBeenCalledWith(USER, "MAINTAINER");
    expect(findMany.mock.calls[0][0].where).toEqual({
      workspace: { realmId: "r1" },
    });
  });
});

describe("MigrationJobsService.get (visibility gate)", () => {
  it("hides another user's run from a non-admin (404)", async () => {
    const { svc } = makeService({
      jobFindUnique: jest
        .fn()
        .mockResolvedValue({ ...jobRow({ createdById: "someone-else" }), items: [] }),
      requireWorkspaceRole: jest.fn().mockResolvedValue("EDIT"),
    });
    await expect(svc.get(USER, "job1")).rejects.toThrow(NotFoundException);
  });

  it("returns the job + items and never leaks lease fields", async () => {
    const item = {
      id: "i1",
      sourceDocId: "root",
      plannedParentDocId: null,
      title: "Root",
      targetCodaPageId: null,
      override: false,
      codaPageId: "cp",
      migratedSeq: 3,
      status: "SUCCEEDED",
      attempts: 1,
      lastError: null,
      seq: 0,
      leasedBy: "worker-1",
      leasedUntil: new Date(),
    };
    const { svc } = makeService({
      jobFindUnique: jest
        .fn()
        .mockResolvedValue({ ...jobRow(), items: [item] }),
      requireWorkspaceRole: jest.fn().mockResolvedValue("EDIT"),
    });
    const res = await svc.get(USER, "job1");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).not.toHaveProperty("leasedBy");
    expect(res.items[0]).not.toHaveProperty("leasedUntil");
    expect(res.items[0].codaPageId).toBe("cp");
  });
});

describe("MigrationJobsService.cancel", () => {
  it("cancels a running job and skips its non-terminal items", async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const jobUpdate = jest.fn(async ({ data }: any) => ({ ...jobRow(), ...data }));
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "RUNNING" })),
      txItemUpdateMany: itemUpdateMany,
      txJobUpdate: jobUpdate,
    });
    const res = await svc.cancel(USER, "job1");
    expect(itemUpdateMany.mock.calls[0][0].where.status.in).toEqual([
      "PENDING",
      "RUNNING",
    ]);
    expect(itemUpdateMany.mock.calls[0][0].data.status).toBe("SKIPPED");
    expect(jobUpdate.mock.calls[0][0].data.status).toBe("CANCELED");
    expect(res.status).toBe("CANCELED");
  });

  it("rejects canceling a terminal job", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "SUCCEEDED" })),
    });
    await expect(svc.cancel(USER, "job1")).rejects.toThrow(BadRequestException);
  });

  it("lets a non-creator cancel only with workspace ADMIN", async () => {
    const requireWorkspaceRole = jest
      .fn()
      .mockRejectedValue(new ForbiddenException());
    const { svc } = makeService({
      jobFindUnique: jest
        .fn()
        .mockResolvedValue(jobRow({ createdById: "other", status: "RUNNING" })),
      requireWorkspaceRole,
    });
    await expect(svc.cancel(USER, "job1")).rejects.toThrow(ForbiddenException);
    expect(requireWorkspaceRole).toHaveBeenCalledWith(USER, WS, "ADMIN");
  });
});

describe("MigrationJobsService.retry (failed + orphaned re-drive)", () => {
  it("resets FAILED items to PENDING (clears lease/error) and re-queues the job", async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const jobUpdate = jest.fn(async ({ data }: any) => ({ ...jobRow(), ...data }));
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "PARTIAL" })),
      txItemUpdateMany: itemUpdateMany,
      txJobUpdate: jobUpdate,
    });
    const res = await svc.retry(USER, "job1");
    const where = itemUpdateMany.mock.calls[0][0].where;
    const data = itemUpdateMany.mock.calls[0][0].data;
    expect(where.status).toBe("FAILED");
    expect(data.status).toBe("PENDING");
    expect(data.lastError).toBeNull();
    expect(data.leasedBy).toBeNull();
    // codaPageId is NOT touched (half-done items stay idempotent).
    expect(data).not.toHaveProperty("codaPageId");
    expect(jobUpdate.mock.calls[0][0].data.status).toBe("QUEUED");
    expect(res.status).toBe("QUEUED");
  });

  it("also re-drives orphaned 'parent did not migrate' skips (a second updateMany)", async () => {
    // First call = FAILED reset (0 rows), second = orphan SKIPPED reset (1 row).
    const itemUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const jobUpdate = jest.fn(async ({ data }: any) => ({ ...jobRow(), ...data }));
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "PARTIAL" })),
      txItemUpdateMany: itemUpdateMany,
      txJobUpdate: jobUpdate,
    });
    const res = await svc.retry(USER, "job1");
    // The orphan re-drive targets exactly SKIPPED + the parent-failure reason.
    const orphanWhere = itemUpdateMany.mock.calls[1][0].where;
    expect(orphanWhere.status).toBe("SKIPPED");
    expect(orphanWhere.lastError).toBe("parent did not migrate");
    expect(itemUpdateMany.mock.calls[1][0].data.status).toBe("PENDING");
    // Job counters: failed decremented by 0, skipped by the 1 recovered orphan.
    const jobData = jobUpdate.mock.calls[0][0].data;
    expect(jobData.failedItems).toEqual({ decrement: 0 });
    expect(jobData.skippedItems).toEqual({ decrement: 1 });
    expect(res.status).toBe("QUEUED");
  });

  it("rejects retry when there are no failed or orphaned items", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "SUCCEEDED" })),
      txItemUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(svc.retry(USER, "job1")).rejects.toThrow(/no failed items/);
  });

  it("rejects retry while the job is still in progress", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "RUNNING" })),
    });
    await expect(svc.retry(USER, "job1")).rejects.toThrow(/in progress/);
  });
});
