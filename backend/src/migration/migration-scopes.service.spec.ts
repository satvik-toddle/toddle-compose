import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthzService } from "../realm/authz.service";
import type { ActiveRealmService } from "../realm/active-realm.service";
import type { CodaClient } from "../coda/coda.client";
import type { CodaResource } from "../coda/coda.types";
import type { TokenCipher } from "./token-cipher";
import { MigrationScopesService } from "./migration-scopes.service";
import { CreateMigrationScopeDto } from "./dto";

const DOC = "DOC1";

function pageResource(docId: string, pageId: string): CodaResource {
  return {
    type: "page",
    id: pageId,
    href: `https://coda.io/apis/v1/docs/${docId}/pages/${pageId}`,
    browserLink: `https://coda.io/d/${docId}/${pageId}`,
  };
}
function docResource(docId: string): CodaResource {
  return {
    type: "doc",
    id: docId,
    href: `https://coda.io/apis/v1/docs/${docId}`,
    browserLink: `https://docs.superhuman.com/d/${docId}`,
  };
}

function makeService(opts: {
  // resource resolved per token (keyed by token string).
  resolveByToken: Record<string, CodaResource>;
  getPageThrows?: boolean;
  getDocThrows?: boolean;
}) {
  const createMock = jest.fn(async ({ data, include: _include }: any) => ({
    id: "s1",
    workspaceId: data.workspaceId,
    codaDocId: data.codaDocId,
    codaRootPageId: data.codaRootPageId,
    codaRootUrl: data.codaRootUrl,
    label: data.label,
    createdById: data.createdById,
    createdAt: new Date(),
    updatedAt: new Date(),
    tokens: (data.tokens.create as any[]).map((t, i) => ({
      id: `t${i}`,
      scopeId: "s1",
      codaTokenEnc: t.codaTokenEnc,
      codaTokenHint: t.codaTokenHint,
      label: t.label,
      createdAt: new Date(),
    })),
  }));

  const prisma = {
    migrationScope: { create: createMock },
  } as unknown as PrismaService;

  const authz = {
    requireWorkspaceRole: jest.fn().mockResolvedValue("ADMIN"),
    requireRealmRole: jest.fn().mockResolvedValue("OWNER"),
  } as unknown as AuthzService;

  const realm = { id: "realm1" } as unknown as ActiveRealmService;

  const coda = {
    resolveBrowserLink: jest.fn(async (auth: string) => opts.resolveByToken[auth]),
    getPage: jest.fn(async () => {
      if (opts.getPageThrows) throw new Error("403");
      return { id: "p", name: "p" };
    }),
    getDoc: jest.fn(async () => {
      if (opts.getDocThrows) throw new Error("403");
      return { id: DOC };
    }),
  } as unknown as CodaClient;

  const cipher = {
    encrypt: jest.fn((plain: string) => `enc:${plain}`),
  } as unknown as TokenCipher;

  return {
    svc: new MigrationScopesService(prisma, authz, realm, coda, cipher),
    createMock,
    cipher,
  };
}

describe("MigrationScopesService.create", () => {
  it("creates a page-root scope and never returns token plaintext", async () => {
    const { svc, createMock, cipher } = makeService({
      resolveByToken: { "tok-abcd1234": pageResource(DOC, "canvas-root") },
    });
    const dto: CreateMigrationScopeDto = {
      workspaceId: "w1",
      label: "Dest",
      codaUrl: "https://coda.io/d/DOC1/canvas-root",
      tokens: [{ token: "tok-abcd1234", label: "u1" }],
    };
    const view = await svc.create("user1", dto);

    // Persisted with the resolved page as the root and encrypted token + last-4 hint.
    const data = createMock.mock.calls[0][0].data;
    expect(data.codaDocId).toBe(DOC);
    expect(data.codaRootPageId).toBe("canvas-root");
    expect(data.tokens.create[0].codaTokenEnc).toBe("enc:tok-abcd1234");
    expect(data.tokens.create[0].codaTokenHint).toBe("1234");
    expect(cipher.encrypt).toHaveBeenCalledWith("tok-abcd1234");

    // Response is masked: hint only, no plaintext, no ciphertext.
    expect(view.tokens[0].hint).toBe("1234");
    expect(JSON.stringify(view)).not.toContain("tok-abcd1234");
    expect(JSON.stringify(view)).not.toContain("enc:");
  });

  it("creates a whole-doc scope (codaRootPageId null) from a doc URL", async () => {
    const { svc, createMock } = makeService({
      resolveByToken: { "tok-1": docResource(DOC) },
    });
    await svc.create("user1", {
      workspaceId: "w1",
      label: "Whole doc",
      codaUrl: "https://docs.superhuman.com/d/DOC1",
      tokens: [{ token: "tok-1" }],
    });
    const data = createMock.mock.calls[0][0].data;
    expect(data.codaDocId).toBe(DOC);
    expect(data.codaRootPageId).toBeNull();
  });

  it("rejects when a token cannot access the destination", async () => {
    const { svc } = makeService({
      resolveByToken: { "tok-1": pageResource(DOC, "canvas-root") },
      getPageThrows: true,
    });
    await expect(
      svc.create("user1", {
        workspaceId: "w1",
        label: "Dest",
        codaUrl: "url",
        tokens: [{ token: "tok-1" }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when tokens resolve to different destinations", async () => {
    const { svc } = makeService({
      resolveByToken: {
        "tok-1": pageResource(DOC, "canvas-root"),
        "tok-2": pageResource("OTHER", "canvas-root"),
      },
    });
    await expect(
      svc.create("user1", {
        workspaceId: "w1",
        label: "Dest",
        codaUrl: "url",
        tokens: [{ token: "tok-1" }, { token: "tok-2" }],
      }),
    ).rejects.toThrow(/different Coda destinations/);
  });

  it("rejects a non-doc/non-page resource (H5)", async () => {
    const { svc } = makeService({
      resolveByToken: {
        "tok-1": { type: "table", id: "grid-x", href: `https://coda.io/apis/v1/docs/${DOC}/tables/grid-x` },
      },
    });
    await expect(
      svc.create("user1", {
        workspaceId: "w1",
        label: "Dest",
        codaUrl: "url",
        tokens: [{ token: "tok-1" }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
