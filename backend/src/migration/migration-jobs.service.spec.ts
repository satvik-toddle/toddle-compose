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
  getHeadSeq?: jest.Mock;
  txJobFindFirst?: jest.Mock;
  txJobCreate?: jest.Mock;
  jobFindMany?: jest.Mock;
  jobFindUnique?: jest.Mock;
  txItemUpdateMany?: jest.Mock;
  txJobUpdate?: jest.Mock;
}) {
  const scope =
    opts?.scope === undefined ? { id: SCOPE, workspaceId: WS } : opts.scope;

  const tx = {
    migrationJob: {
      findFirst: opts?.txJobFindFirst ?? jest.fn().mockResolvedValue(null),
      create:
        opts?.txJobCreate ?? jest.fn().mockResolvedValue({ id: "job1" }),
      update: opts?.txJobUpdate ?? jest.fn(async ({ data }: any) => ({ ...jobRow(), ...data })),
    },
    migrationJobItem: {
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
    getHeadSeq: opts?.getHeadSeq ?? jest.fn().mockResolvedValue(0),
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

  it("captures the point-in-time enqueuedSeq per item from rtc.getHeadSeq", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const getHeadSeq = jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === "root" ? 10 : 20),
      );
    const { svc, rtc } = makeService({ txJobCreate: create, getHeadSeq });
    await svc.enqueue(USER, SCOPE, plan());
    expect(rtc.getHeadSeq).toHaveBeenCalledWith("root");
    expect(rtc.getHeadSeq).toHaveBeenCalledWith("child");
    const created = create.mock.calls[0][0].data.items.create;
    expect(created.find((i: any) => i.sourceDocId === "root").enqueuedSeq).toBe(
      10,
    );
    expect(created.find((i: any) => i.sourceDocId === "child").enqueuedSeq).toBe(
      20,
    );
  });

  it("fails closed (no job created) when a head-seq read throws", async () => {
    const create = jest.fn().mockResolvedValue({ id: "job1" });
    const { svc } = makeService({
      txJobCreate: create,
      getHeadSeq: jest.fn().mockRejectedValue(new Error("rtc unreachable")),
    });
    await expect(svc.enqueue(USER, SCOPE, plan())).rejects.toThrow(
      /version cursor/,
    );
    expect(create).not.toHaveBeenCalled();
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

describe("MigrationJobsService.retry (failed-only)", () => {
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

  it("rejects retry when there are no failed items", async () => {
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
