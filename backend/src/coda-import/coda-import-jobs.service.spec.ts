import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthzService } from "../realm/authz.service";
import type { CodaClient } from "../coda/coda.client";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { CodaImportCredentialsService } from "./coda-import-credentials.service";
import type { CodaImportWorkerClient } from "./coda-import-worker.client";
import { CodaImportJobsService } from "./coda-import-jobs.service";

const USER = "u1";
const DOC_ID = "doc-abc";
const URL = "https://coda.io/d/Test_dDOCabc";
const CANONICAL = "https://coda.io/d/Test_dDOCabc/canonical";
const CRED = "cred-1";

// A CodaImportJob DB row (the fields toJobSummary reads).
function jobRow(over: Record<string, unknown> = {}) {
  return {
    id: "job1",
    codaDocId: DOC_ID,
    codaDocUrl: CANONICAL,
    targetWorkspaceName: "WS",
    targetWorkspaceId: "ws1",
    status: "RUNNING",
    totalItems: 0,
    succeededItems: 0,
    failedItems: 0,
    skippedItems: 0,
    progressMessage: null,
    planningComplete: false,
    createdById: USER,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...over,
  } as any;
}

function makeService(opts?: {
  requireRealmRole?: jest.Mock;
  getTokenPool?: jest.Mock;
  getToken?: jest.Mock;
  resolveBrowserLink?: jest.Mock;
  getDoc?: jest.Mock;
  getPage?: jest.Mock;
  listPages?: jest.Mock;
  wsCreate?: jest.Mock;
  jobCreate?: jest.Mock;
  jobFindMany?: jest.Mock;
  jobFindUnique?: jest.Mock;
  jobUpdateMany?: jest.Mock;
  jobFindUniqueOrThrow?: jest.Mock;
  eventCreate?: jest.Mock;
  ping?: jest.Mock;
}) {
  const prisma = {
    codaImportJob: {
      create:
        opts?.jobCreate ??
        jest.fn().mockResolvedValue({ id: "job1", status: "QUEUED" }),
      findMany: opts?.jobFindMany ?? jest.fn().mockResolvedValue([]),
      findUnique: opts?.jobFindUnique ?? jest.fn().mockResolvedValue(null),
      updateMany: opts?.jobUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow:
        opts?.jobFindUniqueOrThrow ??
        jest.fn().mockResolvedValue(jobRow({ status: "CANCELED" })),
    },
    codaImportJobEvent: {
      create: opts?.eventCreate ?? jest.fn().mockResolvedValue({ id: "ev1" }),
    },
  } as unknown as PrismaService;

  const authz = {
    requireRealmRole:
      opts?.requireRealmRole ?? jest.fn().mockResolvedValue("OWNER"),
  } as unknown as AuthzService;

  const coda = {
    resolveBrowserLink:
      opts?.resolveBrowserLink ??
      jest.fn().mockResolvedValue({
        type: "doc",
        id: DOC_ID,
        browserLink: CANONICAL,
      }),
    getDoc:
      opts?.getDoc ?? jest.fn().mockResolvedValue({ id: DOC_ID, name: "My Doc" }),
    getPage:
      opts?.getPage ??
      jest.fn().mockResolvedValue({ id: "page-1", name: "Page One" }),
    listPages:
      opts?.listPages ?? jest.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
  } as unknown as CodaClient;

  const workspaces = {
    create: opts?.wsCreate ?? jest.fn().mockResolvedValue({ id: "ws1" }),
  } as unknown as WorkspacesService;

  const credentials = {
    getTokenPool: opts?.getTokenPool ?? jest.fn().mockResolvedValue(["tok-1"]),
    getToken: opts?.getToken ?? jest.fn().mockResolvedValue("tok-1"),
  } as unknown as CodaImportCredentialsService;

  const worker = {
    ping: opts?.ping ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as CodaImportWorkerClient;

  return {
    svc: new CodaImportJobsService(
      prisma,
      authz,
      coda,
      workspaces,
      credentials,
      worker,
    ),
    prisma,
    authz,
    coda,
    workspaces,
    credentials,
    worker,
  };
}

describe("CodaImportJobsService.validate", () => {
  it("a doc URL → whole-doc: doc name, all pages, null root page id", async () => {
    const { svc, coda } = makeService();
    const res = await svc.validate(USER, URL, CRED);
    expect(res).toEqual({
      codaDocId: DOC_ID,
      codaRootPageId: null,
      rootName: "My Doc",
      pageCount: 2,
      canonicalUrl: CANONICAL,
    });
    expect(coda.getDoc).toHaveBeenCalledWith(["tok-1"], DOC_ID);
    expect(coda.listPages).toHaveBeenCalledWith(["tok-1"], DOC_ID);
  });

  it("a page URL → page-subtree: page name, ROOT+DESCENDANT count, root page id set", async () => {
    // Root "page-1" has 2 direct children (one with a grandchild) + an unrelated
    // top-level page; count = the root page itself + its 3 descendants = 4.
    const resolveBrowserLink = jest.fn().mockResolvedValue({
      type: "page",
      id: "page-1",
      href: `https://coda.io/apis/v1/docs/${DOC_ID}/pages/page-1`,
      browserLink: CANONICAL,
    });
    const listPages = jest.fn().mockResolvedValue([
      { id: "page-1", name: "Satvik" },
      { id: "c1", name: "Child 1", parent: { id: "page-1" } },
      { id: "c2", name: "Child 2", parent: { id: "page-1" } },
      { id: "gc1", name: "Grandchild", parent: { id: "c1" } },
      { id: "other", name: "Unrelated top-level" },
    ]);
    const getDoc = jest.fn();
    const { svc, coda } = makeService({ resolveBrowserLink, listPages, getDoc });
    const res = await svc.validate(USER, URL, CRED);
    expect(res).toEqual({
      codaDocId: DOC_ID,
      codaRootPageId: "page-1",
      rootName: "Satvik",
      pageCount: 4,
      canonicalUrl: CANONICAL,
    });
    // The doc name is irrelevant for a page-subtree import.
    expect(getDoc).not.toHaveBeenCalled();
    expect(coda.listPages).toHaveBeenCalledWith(["tok-1"], DOC_ID);
  });

  it("a page URL falls back to getPage for the name when the listing omits it", async () => {
    const resolveBrowserLink = jest.fn().mockResolvedValue({
      type: "page",
      id: "page-1",
      href: `https://coda.io/apis/v1/docs/${DOC_ID}/pages/page-1`,
      browserLink: CANONICAL,
    });
    // page-1 not present in the listing → name comes from getPage.
    const listPages = jest.fn().mockResolvedValue([{ id: "x" }]);
    const getPage = jest
      .fn()
      .mockResolvedValue({ id: "page-1", name: "Fetched Name" });
    const { svc } = makeService({ resolveBrowserLink, listPages, getPage });
    const res = await svc.validate(USER, URL, CRED);
    expect(res.rootName).toBe("Fetched Name");
    // 0 descendants in the listing + the root page itself = 1.
    expect(res.pageCount).toBe(1);
    expect(getPage).toHaveBeenCalledWith(["tok-1"], DOC_ID, "page-1");
  });

  it("rejects when credentialId is absent", async () => {
    const getToken = jest.fn();
    const { svc } = makeService({ getToken });
    await expect(svc.validate(USER, URL, "")).rejects.toThrow(
      BadRequestException,
    );
    expect(getToken).not.toHaveBeenCalled();
  });

  it("rejects when the picked credential is not found", async () => {
    const getToken = jest
      .fn()
      .mockRejectedValue(new NotFoundException("Coda import credential not found"));
    const { svc } = makeService({ getToken });
    await expect(svc.validate(USER, URL, CRED)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a non-realm-admin caller before touching Coda", async () => {
    const getToken = jest.fn();
    const { svc } = makeService({
      getToken,
      requireRealmRole: jest.fn().mockRejectedValue(new ForbiddenException()),
    });
    await expect(svc.validate(USER, URL, CRED)).rejects.toThrow(
      ForbiddenException,
    );
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("CodaImportJobsService.enqueue", () => {
  it("creates the workspace, a QUEUED job with the re-resolved doc id, and pings the worker", async () => {
    const jobCreate = jest
      .fn()
      .mockResolvedValue({ id: "job1", status: "QUEUED" });
    const wsCreate = jest.fn().mockResolvedValue({ id: "ws1" });
    const ping = jest.fn().mockResolvedValue(undefined);
    const { svc } = makeService({ jobCreate, wsCreate, ping });

    const res = await svc.enqueue(USER, {
      codaDocUrl: URL,
      workspaceName: "Imported WS",
      credentialId: CRED,
    });

    expect(res).toEqual({ jobId: "job1", workspaceId: "ws1", status: "QUEUED" });
    expect(wsCreate).toHaveBeenCalledWith(USER, { name: "Imported WS" });

    const data = jobCreate.mock.calls[0][0].data;
    expect(data.codaDocId).toBe(DOC_ID);
    expect(data.codaDocUrl).toBe(CANONICAL);
    expect(data.credentialId).toBe(CRED);
    // A doc URL → whole-doc import (no root page).
    expect(data.codaRootPageId).toBeNull();
    expect(data.targetWorkspaceId).toBe("ws1");
    expect(data.targetWorkspaceName).toBe("Imported WS");
    expect(data.createdById).toBe(USER);
    expect(data.status).toBe("QUEUED");
    expect(data.totalItems).toBe(0);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("inserts a 'Workspace created' milestone event for the new job", async () => {
    const eventCreate = jest.fn().mockResolvedValue({ id: "ev1" });
    const { svc } = makeService({ eventCreate });
    await svc.enqueue(USER, {
      codaDocUrl: URL,
      workspaceName: "Imported WS",
      credentialId: CRED,
    });
    expect(eventCreate).toHaveBeenCalledWith({
      data: { jobId: "job1", message: 'Workspace "Imported WS" created' },
    });
  });

  it("persists codaRootPageId when the URL resolves to a page (subtree import)", async () => {
    const jobCreate = jest
      .fn()
      .mockResolvedValue({ id: "job1", status: "QUEUED" });
    const resolveBrowserLink = jest.fn().mockResolvedValue({
      type: "page",
      id: "page-1",
      href: `https://coda.io/apis/v1/docs/${DOC_ID}/pages/page-1`,
      browserLink: CANONICAL,
    });
    const { svc } = makeService({ jobCreate, resolveBrowserLink });

    await svc.enqueue(USER, {
      codaDocUrl: URL,
      workspaceName: "Satvik",
      credentialId: CRED,
    });

    const data = jobCreate.mock.calls[0][0].data;
    expect(data.codaDocId).toBe(DOC_ID);
    expect(data.codaRootPageId).toBe("page-1");
    expect(data.targetWorkspaceName).toBe("Satvik");
  });

  it("does not create a workspace when the picked credential is not found", async () => {
    const wsCreate = jest.fn();
    const { svc } = makeService({
      wsCreate,
      getToken: jest
        .fn()
        .mockRejectedValue(new NotFoundException("Coda import credential not found")),
    });
    await expect(
      svc.enqueue(USER, { codaDocUrl: URL, workspaceName: "x", credentialId: CRED }),
    ).rejects.toThrow(NotFoundException);
    expect(wsCreate).not.toHaveBeenCalled();
  });
});

describe("CodaImportJobsService.get (detail)", () => {
  it("returns the run with its items (by seq) and its ordered milestone events", async () => {
    const events = [
      { message: "Workspace \"WS\" created", createdAt: new Date("2026-01-01T00:00:00Z") },
      { message: "Fetching pages from Coda…", createdAt: new Date("2026-01-01T00:00:01Z") },
    ];
    const jobFindUnique = jest
      .fn()
      .mockResolvedValue(jobRow({ items: [], events }));
    const { svc } = makeService({ jobFindUnique });

    const res = await svc.get(USER, "job1");

    // The detail query includes both the items (by seq) and the events (by createdAt asc).
    const include = jobFindUnique.mock.calls[0][0].include;
    expect(include.items.orderBy).toEqual({ seq: "asc" });
    expect(include.events.orderBy).toEqual({ createdAt: "asc" });
    expect(include.events.select).toEqual({ message: true, createdAt: true });
    expect(res.events).toEqual(events);
  });

  it("404s when the job does not exist", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.get(USER, "gone")).rejects.toThrow(NotFoundException);
  });
});

describe("CodaImportJobsService.cancel", () => {
  it("flips a QUEUED/RUNNING job to CANCELED (guarded on non-terminal) and returns it", async () => {
    const jobUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "RUNNING" })),
      jobUpdateMany,
      jobFindUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(jobRow({ status: "CANCELED", finishedAt: new Date() })),
    });

    const res = await svc.cancel(USER, "job1");

    const arg = jobUpdateMany.mock.calls[0][0];
    // Only a non-terminal job flips; the activity line is cleared.
    expect(arg.where).toEqual({ id: "job1", status: { in: ["QUEUED", "RUNNING"] } });
    expect(arg.data.status).toBe("CANCELED");
    expect(arg.data.progressMessage).toBeNull();
    expect(arg.data.finishedAt).toBeInstanceOf(Date);
    expect(res.status).toBe("CANCELED");
  });

  it("logs an 'Import canceled' milestone event after a successful cancel", async () => {
    const eventCreate = jest.fn().mockResolvedValue({ id: "ev1" });
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "RUNNING" })),
      jobUpdateMany: jest.fn().mockResolvedValue({ count: 1 }),
      jobFindUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(jobRow({ status: "CANCELED" })),
      eventCreate,
    });
    await svc.cancel(USER, "job1");
    expect(eventCreate).toHaveBeenCalledWith({
      data: { jobId: "job1", message: "Import canceled" },
    });
  });

  it("does NOT log a cancel event when the job is already terminal (409)", async () => {
    const eventCreate = jest.fn();
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "SUCCEEDED" })),
      jobUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
      eventCreate,
    });
    await expect(svc.cancel(USER, "job1")).rejects.toThrow(ConflictException);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("404s when the job does not exist", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.cancel(USER, "gone")).rejects.toThrow(NotFoundException);
  });

  it("409s when the job is already terminal (nothing to cancel)", async () => {
    const { svc } = makeService({
      jobFindUnique: jest.fn().mockResolvedValue(jobRow({ status: "SUCCEEDED" })),
      // The guarded updateMany matches 0 rows for a terminal job.
      jobUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(svc.cancel(USER, "job1")).rejects.toThrow(ConflictException);
  });

  it("rejects a non-realm-admin caller", async () => {
    const { svc } = makeService({
      requireRealmRole: jest.fn().mockRejectedValue(new ForbiddenException()),
    });
    await expect(svc.cancel(USER, "job1")).rejects.toThrow(ForbiddenException);
  });
});
