import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { CodaClient } from "../coda/coda.client";
import type { CodaResource, CodaPage } from "../coda/coda.types";
import type { CodaCredentialsService } from "./coda-credentials.service";
import { ScopeValidationService } from "./scope-validation.service";

const DOC = "DOC1";
const ROOT = "canvas-root";

function pageResource(docId: string, pageId: string): CodaResource {
  return {
    type: "page",
    id: pageId,
    href: `https://coda.io/apis/v1/docs/${docId}/pages/${pageId}`,
    browserLink: `https://coda.io/d/${docId}/${pageId}`,
  };
}

// scope: null codaRootPageId → whole-doc; string → page-root.
function makeService(opts: {
  scope: { codaDocId: string; codaRootPageId: string | null } | null;
  resource: CodaResource | (() => never);
  // parent id keyed by page id, for the ancestor walk.
  parents?: Record<string, string | null>;
  // true → a mapping targets the root page (imported root override).
  importedRoot?: boolean;
}) {
  const prisma = {
    migrationScope: {
      findFirst: jest.fn().mockResolvedValue(
        opts.scope ? { id: "s1", ...opts.scope } : null,
      ),
    },
    migrationMapping: {
      findFirst: jest.fn().mockResolvedValue(
        opts.importedRoot ? { id: "m1" } : null,
      ),
    },
  } as unknown as PrismaService;

  const coda = {
    resolveBrowserLink: jest.fn(async () => {
      if (typeof opts.resource === "function") return opts.resource();
      return opts.resource;
    }),
    getPage: jest.fn(async (_auth, _docId, pageId: string): Promise<CodaPage> => {
      const parentId = opts.parents?.[pageId] ?? null;
      return {
        id: pageId,
        name: pageId,
        parent: parentId ? { id: parentId } : undefined,
      };
    }),
  } as unknown as CodaClient;

  const credentials = {
    getTokenPool: jest.fn().mockResolvedValue(["tok"]),
  } as unknown as CodaCredentialsService;

  return {
    svc: new ScopeValidationService(prisma, coda, credentials),
    coda,
  };
}

describe("ScopeValidationService.validateDestinationUrl", () => {
  it("accepts a descendant of the scope root (page-root)", async () => {
    const { svc, coda } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource(DOC, "canvas-child"),
      // child → mid → ROOT
      parents: { "canvas-child": "canvas-mid", "canvas-mid": ROOT },
    });
    await expect(svc.validateDestinationUrl("s1", "url")).resolves.toEqual({
      codaPageId: "canvas-child",
    });
    expect((coda.getPage as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a page in a different Coda doc", async () => {
    const { svc } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource("OTHER_DOC", "canvas-child"),
    });
    await expect(svc.validateDestinationUrl("s1", "url")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects targeting the scope root itself", async () => {
    const { svc } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource(DOC, ROOT),
    });
    await expect(svc.validateDestinationUrl("s1", "url")).rejects.toThrow(
      /root/,
    );
  });

  it("accepts the scope root itself when it is an imported root (a mapping points to it)", async () => {
    const { svc } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource(DOC, ROOT),
      importedRoot: true,
    });
    await expect(svc.validateDestinationUrl("s1", "url")).resolves.toEqual({
      codaPageId: ROOT,
    });
  });

  it("rejects a non-descendant (parent chain never reaches root)", async () => {
    const { svc } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource(DOC, "canvas-orphan"),
      parents: { "canvas-orphan": "canvas-elsewhere", "canvas-elsewhere": null },
    });
    await expect(svc.validateDestinationUrl("s1", "url")).rejects.toThrow(
      /within the scope root/,
    );
  });

  it("rejects a non-page resource (H5)", async () => {
    const { svc } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: { type: "table", id: "grid-x", href: `https://coda.io/apis/v1/docs/${DOC}/tables/grid-x` },
    });
    await expect(svc.validateDestinationUrl("s1", "url")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("accepts any in-doc page for a whole-doc scope (no ancestor walk)", async () => {
    const { svc, coda } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: null },
      resource: pageResource(DOC, "canvas-anywhere"),
    });
    await expect(svc.validateDestinationUrl("s1", "url")).resolves.toEqual({
      codaPageId: "canvas-anywhere",
    });
    expect((coda.getPage as jest.Mock).mock.calls.length).toBe(0);
  });

  it("caches a verified (scope,url) so a re-check within TTL makes no Coda calls", async () => {
    const { svc, coda } = makeService({
      scope: { codaDocId: DOC, codaRootPageId: ROOT },
      resource: pageResource(DOC, "canvas-child"),
      parents: { "canvas-child": ROOT },
    });
    await expect(svc.validateDestinationUrl("s1", "url")).resolves.toEqual({ codaPageId: "canvas-child" });
    const resolveCalls = (coda.resolveBrowserLink as jest.Mock).mock.calls.length;
    const getCalls = (coda.getPage as jest.Mock).mock.calls.length;
    // Second call (as the enqueue path does right after verify) is served from cache.
    await expect(svc.validateDestinationUrl("s1", "url")).resolves.toEqual({ codaPageId: "canvas-child" });
    expect((coda.resolveBrowserLink as jest.Mock).mock.calls.length).toBe(resolveCalls);
    expect((coda.getPage as jest.Mock).mock.calls.length).toBe(getCalls);
  });
});
