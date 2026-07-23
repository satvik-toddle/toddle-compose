import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { CodaClient } from "../coda/coda.client";
import type { DocumentsService } from "../documents/documents.service";
import type { RtcContentClient } from "../rtc/rtc-content.client";
import type { RtcInternalClient } from "../rtc/rtc-internal.client";
import type { AuthUser } from "../auth/current-user.decorator";
import type { CodaCredentialsService } from "./coda-credentials.service";
import type { ScopeValidationService } from "./scope-validation.service";
import { ImportFromCodaService } from "./import-from-coda.service";

const USER: AuthUser = {
  id: "u1",
  email: "u@x.com",
  name: "U",
  color: "#000",
  activeWorkspaceId: "w1",
};

function makeService(opts: {
  role?: "editor" | "viewer";
  doc?: { workspaceId: string } | null;
  scope?: { workspaceId: string; codaDocId: string } | null;
  exportHtml?: string;
} = {}) {
  const documents = {
    resolveRtcRole: jest.fn().mockResolvedValue(opts.role ?? "editor"),
  } as unknown as DocumentsService;

  const prisma = {
    document: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.doc === undefined ? { workspaceId: "w1" } : opts.doc,
        ),
    },
    migrationScope: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.scope === undefined
            ? { workspaceId: "w1", codaDocId: "DOC1" }
            : opts.scope,
        ),
    },
  } as unknown as PrismaService;

  const scopeValidation = {
    validateDestinationUrl: jest
      .fn()
      .mockResolvedValue({ codaPageId: "canvas-target" }),
  } as unknown as ScopeValidationService;

  const credentials = {
    getTokenPool: jest.fn().mockResolvedValue(["tok"]),
  } as unknown as CodaCredentialsService;

  const coda = {
    exportPage: jest
      .fn()
      .mockResolvedValue(
        opts.exportHtml ?? "<div><p>hello</p><iframe src='https://x.io'></iframe></div>",
      ),
  } as unknown as CodaClient;

  const rtcContent = {
    replaceHtml: jest.fn().mockResolvedValue(7),
  } as unknown as RtcContentClient;

  const rtcInternal = {
    initDocBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as RtcInternalClient;

  const svc = new ImportFromCodaService(
    prisma,
    documents,
    scopeValidation,
    credentials,
    coda,
    rtcContent,
    rtcInternal,
  );
  return { svc, documents, prisma, scopeValidation, credentials, coda, rtcContent, rtcInternal };
}

describe("ImportFromCodaService.import", () => {
  it("validates → exports → sanitizes → replaceHtml with the sanitized html", async () => {
    const { svc, scopeValidation, credentials, coda, rtcContent, rtcInternal } =
      makeService();

    const result = await svc.import(USER, "d1", "s1", "https://coda.io/d/DOC1/pg");

    expect(scopeValidation.validateDestinationUrl).toHaveBeenCalledWith(
      "s1",
      "https://coda.io/d/DOC1/pg",
    );
    expect(credentials.getTokenPool).toHaveBeenCalledWith("s1");
    expect(coda.exportPage).toHaveBeenCalledWith(["tok"], "DOC1", "canvas-target");
    expect(rtcInternal.initDocBestEffort).toHaveBeenCalledWith("d1");

    // The iframe embed is rewritten to a link and the wrapper div unwrapped by the sanitizer.
    const [docId, html, user] = (
      rtcContent.replaceHtml as jest.Mock
    ).mock.calls[0];
    expect(docId).toBe("d1");
    expect(user).toBe(USER);
    expect(html).toContain("<p>hello</p>");
    expect(html).not.toContain("<div>");
    expect(html).toContain('href="https://x.io"');

    expect(result.ok).toBe(true);
    expect(result.losses).toEqual(
      expect.arrayContaining([expect.stringContaining("embed")]),
    );
  });

  it("rejects a non-editor before touching Coda", async () => {
    const { svc, coda, rtcContent } = makeService({ role: "viewer" });
    await expect(
      svc.import(USER, "d1", "s1", "https://coda.io/d/DOC1/pg"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(coda.exportPage).not.toHaveBeenCalled();
    expect(rtcContent.replaceHtml).not.toHaveBeenCalled();
  });

  it("404s when the scope belongs to another workspace", async () => {
    const { svc } = makeService({
      scope: { workspaceId: "other", codaDocId: "DOC1" },
    });
    await expect(
      svc.import(USER, "d1", "s1", "https://coda.io/d/DOC1/pg"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
