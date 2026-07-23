import { gzipSync } from "node:zlib";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { CodaClient } from "./coda.client";
import { CodaRateLimiter } from "./coda-rate-limiter";

// Minimal ConfigService stand-in (no token here — tokens are passed per call).
function makeConfig(
  overrides: Partial<Record<string, unknown>> = {},
): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CODA_API_BASE_URL: "https://coda.io/apis/v1",
    CODA_REQUEST_TIMEOUT_MS: 15_000,
    CODA_MAX_RETRIES: 5,
    CODA_MUTATION_TIMEOUT_MS: 180_000,
    CODA_MUTATION_POLL_MS: 5,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<
    Env,
    true
  >;
}

interface FakeResponseOpts {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeResponse({ status = 200, body = {}, headers = {} }: FakeResponseOpts): Response {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// A signed-URL download response: exposes arrayBuffer() (used for gzipped bodies)
// alongside text(), plus content-encoding so the client can detect compression.
function fakeDownload({
  status = 200,
  bytes,
  text,
  headers = {},
}: {
  status?: number;
  bytes?: Uint8Array;
  text?: string;
  headers?: Record<string, string>;
}): Response {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: async () => text ?? "",
    // undici exposes the (already content-decoded) body via arrayBuffer; mirror that —
    // fall back to the utf8 bytes of `text` when no explicit byte payload is given.
    arrayBuffer: async () =>
      Uint8Array.from(bytes ?? Buffer.from(text ?? "", "utf8")).buffer,
  } as unknown as Response;
}

function newClient(config = makeConfig()): {
  client: CodaClient;
  fetchMock: jest.Mock;
} {
  const limiter = new CodaRateLimiter();
  const client = new CodaClient(config, limiter);
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  return { client, fetchMock };
}

// Pull (url, init) from a recorded fetch call.
function callArgs(fetchMock: jest.Mock, i = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i];
  return { url: String(url), init: init as RequestInit };
}

const bearer = (init: RequestInit): string =>
  (init.headers as Record<string, string>).Authorization;

const TOKEN = "tok-1";

describe("CodaClient", () => {
  afterEach(() => jest.restoreAllMocks());

  it("resolveBrowserLink builds the query and returns the resource", async () => {
    const { client, fetchMock } = newClient();
    const resource = { type: "page", id: "canvas-abc", name: "P", href: "h" };
    fetchMock.mockResolvedValue(fakeResponse({ body: { resource } }));

    const result = await client.resolveBrowserLink(
      TOKEN,
      "https://coda.io/d/_dXY/Page_su123",
    );

    expect(result).toEqual(resource);
    const { url, init } = callArgs(fetchMock);
    expect(init.method).toBe("GET");
    expect(url).toContain("https://coda.io/apis/v1/resolveBrowserLink?");
    expect(url).toContain("degradeGracefully=true");
    expect(url).toContain(
      `url=${encodeURIComponent("https://coda.io/d/_dXY/Page_su123")}`,
    );
    expect(bearer(init)).toBe("Bearer tok-1");
  });

  it("getPage hits the page metadata URL", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(
      fakeResponse({ body: { id: "canvas-1", name: "N", parent: { id: "canvas-0" } } }),
    );

    const page = await client.getPage(TOKEN, "doc1", "canvas-1");

    expect(page.parent?.id).toBe("canvas-0");
    expect(callArgs(fetchMock).url).toBe("https://coda.io/apis/v1/docs/doc1/pages/canvas-1");
  });

  it("getPageOrNull returns the page on 200", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(
      fakeResponse({ body: { id: "canvas-1", name: "N", browserLink: "https://x/_su1" } }),
    );
    const page = await client.getPageOrNull(TOKEN, "doc1", "canvas-1");
    expect(page?.browserLink).toBe("https://x/_su1");
  });

  it("getPageOrNull returns null on a 404 (page not yet materialized)", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ status: 404, body: { message: "not found" } }));
    const page = await client.getPageOrNull(TOKEN, "doc1", "canvas-1");
    expect(page).toBeNull();
  });

  it("getPageOrNull rethrows a non-404 error", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, body: { message: "server error" } }));
    await expect(
      client.getPageOrNull(TOKEN, "doc1", "canvas-1"),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("createPage sends the canvas HTML body and returns the requestId", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ status: 202, body: { id: "canvas-9", requestId: "req-9" } }));

    const res = await client.createPage(TOKEN, "doc1", {
      name: "Hello",
      subtitle: "Sub",
      parentPageId: "canvas-parent",
      html: "<p>hi</p>",
    });

    expect(res).toEqual({ id: "canvas-9", requestId: "req-9" });
    const { url, init } = callArgs(fetchMock);
    expect(init.method).toBe("POST");
    expect(url).toBe("https://coda.io/apis/v1/docs/doc1/pages");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Hello",
      subtitle: "Sub",
      parentPageId: "canvas-parent",
      pageContent: {
        type: "canvas",
        canvasContent: { format: "html", content: "<p>hi</p>" },
      },
    });
  });

  it("createPage omits optional fields when not provided", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { id: "x", requestId: "r" } }));

    await client.createPage(TOKEN, "doc1", { name: "Only", html: "<p/>" });

    const body = JSON.parse(callArgs(fetchMock).init.body as string);
    expect(body).not.toHaveProperty("subtitle");
    expect(body).not.toHaveProperty("parentPageId");
  });

  it("replacePageContent uses PUT with insertionMode=replace", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { id: "p", requestId: "r" } }));

    await client.replacePageContent(TOKEN, "doc1", "canvas-1", "<p>new</p>");

    const { url, init } = callArgs(fetchMock);
    expect(init.method).toBe("PUT");
    expect(url).toBe("https://coda.io/apis/v1/docs/doc1/pages/canvas-1");
    expect(JSON.parse(init.body as string)).toEqual({
      contentUpdate: {
        insertionMode: "replace",
        canvasContent: { format: "html", content: "<p>new</p>" },
      },
    });
  });

  it("appendPageContent uses insertionMode=append", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { id: "p", requestId: "r" } }));

    await client.appendPageContent(TOKEN, "doc1", "canvas-1", "<p>more</p>");

    const body = JSON.parse(callArgs(fetchMock).init.body as string);
    expect(body.contentUpdate.insertionMode).toBe("append");
  });

  it("awaitMutation polls getMutationStatus until completed", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ body: { completed: false } }))
      .mockResolvedValueOnce(fakeResponse({ body: { completed: false } }))
      .mockResolvedValueOnce(fakeResponse({ body: { completed: true } }));

    await client.awaitMutation(TOKEN, "req-1", { pollMs: 5, timeoutMs: 2_000 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(callArgs(fetchMock).url).toBe("https://coda.io/apis/v1/mutationStatus/req-1");
  });

  it("awaitMutation THROWS when completed with a warning (Coda-side failure, not success)", async () => {
    const { client, fetchMock } = newClient();
    // completed:true + a warning means the mutation FAILED on Coda's side.
    fetchMock.mockResolvedValue(
      fakeResponse({
        body: { completed: true, warning: "Some content could not be imported" },
      }),
    );

    const err = (await client
      .awaitMutation(TOKEN, "req-warn", { pollMs: 5, timeoutMs: 2_000 })
      .catch((e) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    // Shaped so the worker classifies it PERMANENT (status 422, distinct error string).
    expect(err.getResponse()).toMatchObject({
      error: "coda mutation failed",
      status: 422,
      body: "Some content could not be imported",
    });
  });

  it("awaitMutation throws 504 when the deadline passes", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { completed: false } }));

    await expect(
      client.awaitMutation(TOKEN, "req-1", { pollMs: 5, timeoutMs: 30 }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("awaitMutation treats a 404 mutationStatus as completed (Coda GCs the record)", async () => {
    const { client, fetchMock } = newClient();
    // A completed-then-expired mutation returns 404 on its status record.
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 404,
        body: { message: "No request was found with the given id, or it has expired." },
      }),
    );

    await expect(
      client.awaitMutation(TOKEN, "req-gone", { pollMs: 5, timeoutMs: 2_000 }),
    ).resolves.toBeUndefined();
    // Returns immediately — a 404 is not a retryable pending state.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("awaitMutation rethrows a genuine (non-404) mutationStatus error", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, body: "upstream boom" }));

    await expect(
      client.awaitMutation(TOKEN, "req-1", { pollMs: 5, timeoutMs: 2_000 }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("retries on 429 honoring Retry-After, then succeeds", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ status: 429, headers: { "retry-after": "0" }, body: {} }),
      )
      .mockResolvedValueOnce(fakeResponse({ body: { id: "p", requestId: "r" } }));

    const res = await client.createPage(TOKEN, "doc1", { name: "N", html: "<p/>" });

    expect(res.requestId).toBe("r");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reroutes a 429 to another token when given a pool (per-token isolation)", async () => {
    const { client, fetchMock } = newClient();
    // First attempt (token a) is rate-limited; retry must use the other pool token.
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ status: 429, headers: { "retry-after": "300" }, body: {} }),
      )
      .mockResolvedValueOnce(fakeResponse({ body: { id: "p", requestId: "r" } }));

    const res = await client.createPage(["a", "b"], "doc1", { name: "N", html: "<p/>" });

    expect(res.requestId).toBe("r");
    expect(bearer(callArgs(fetchMock, 0).init)).toBe("Bearer a");
    // Token a is parked 300s, so the retry reroutes to b immediately.
    expect(bearer(callArgs(fetchMock, 1).init)).toBe("Bearer b");
  });

  it("distributes calls across a token pool (least-loaded)", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { id: "p", requestId: "r" } }));

    for (let i = 0; i < 4; i++) {
      await client.createPage(["a", "b"], "doc1", { name: "N", html: "<p/>" });
    }
    const used = fetchMock.mock.calls.map((c) => bearer(c[1] as RequestInit));
    expect(used.filter((t) => t === "Bearer a").length).toBe(2);
    expect(used.filter((t) => t === "Bearer b").length).toBe(2);
  });

  it("gives up after CODA_MAX_RETRIES 429s with a 429 HttpException", async () => {
    const { client, fetchMock } = newClient(makeConfig({ CODA_MAX_RETRIES: 2 }));
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 429, headers: { "retry-after": "0" }, body: {} }),
    );

    await expect(
      client.createPage(TOKEN, "doc1", { name: "N", html: "<p/>" }),
    ).rejects.toMatchObject({ status: 429 });
    // attempts 0,1,2 → 3 calls before giving up at attempt === maxRetries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws 500 when no token is supplied", async () => {
    const { client, fetchMock } = newClient();
    await expect(client.getPage([], "doc1", "canvas-1")).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a network failure to a 502", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.getPage(TOKEN, "doc1", "canvas-1")).rejects.toBeInstanceOf(HttpException);
    await expect(client.getPage(TOKEN, "doc1", "canvas-1")).rejects.toMatchObject({ status: 502 });
  });

  it("maps a non-429 upstream error to a 502 and surfaces the upstream body", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 400, body: "Invalid parentPageId: could not find page" }),
    );

    const err = (await client
      .getPage(TOKEN, "doc1", "canvas-1")
      .catch((e) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
    // The structured payload carries the real upstream status + a truncated body.
    expect(err.getResponse()).toMatchObject({
      error: "coda api error",
      status: 400,
      body: expect.stringContaining("Invalid parentPageId"),
    });
  });

  it("listPages follows nextPageToken and merges every page", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            items: [{ id: "canvas-1", name: "A" }, { id: "canvas-2", name: "B" }],
            nextPageToken: "tok-next",
          },
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          body: { items: [{ id: "canvas-3", name: "C", parent: { id: "canvas-1" } }] },
        }),
      );

    const onProgress = jest.fn();
    const pages = await client.listPages(TOKEN, "doc1", onProgress);

    expect(pages.map((p) => p.id)).toEqual(["canvas-1", "canvas-2", "canvas-3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callArgs(fetchMock, 0).url).toBe(
      "https://coda.io/apis/v1/docs/doc1/pages?limit=100",
    );
    // The second request carries the token returned by the first.
    expect(callArgs(fetchMock, 1).url).toContain("pageToken=tok-next");
    // onProgress fires after each batch with the cumulative page count so far.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });

  it("listPages works without an onProgress callback (optional param)", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ body: { items: [{ id: "canvas-1", name: "A" }] } }),
    );
    const pages = await client.listPages(TOKEN, "doc1");
    expect(pages.map((p) => p.id)).toEqual(["canvas-1"]);
  });

  it("exportPage begins, polls to complete, and gunzips a gzipped download", async () => {
    const { client, fetchMock } = newClient();
    const html = "<h1>Exported</h1>";
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-1", status: "inProgress", href: "h" } }),
      )
      .mockResolvedValueOnce(fakeResponse({ body: { id: "exp-1", status: "inProgress", href: "h" } }))
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            id: "exp-1",
            status: "complete",
            href: "h",
            downloadLink: "https://export.coda.io/signed/out.html.gz",
          },
        }),
      )
      .mockResolvedValueOnce(
        fakeDownload({ bytes: gzipSync(Buffer.from(html, "utf8")) }),
      );

    const result = await client.exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 });

    expect(result).toBe(html);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Begin is a POST to the export endpoint with outputFormat=html.
    const begin = callArgs(fetchMock, 0);
    expect(begin.init.method).toBe("POST");
    expect(begin.url).toBe("https://coda.io/apis/v1/docs/doc1/pages/canvas-1/export");
    expect(JSON.parse(begin.init.body as string)).toEqual({ outputFormat: "html" });
    // Poll hits the export-status path keyed by the returned request id.
    expect(callArgs(fetchMock, 1).url).toBe(
      "https://coda.io/apis/v1/docs/doc1/pages/canvas-1/export/exp-1",
    );
    // The signed download is fetched directly, without an Authorization header.
    const download = callArgs(fetchMock, 3);
    expect(download.url).toBe("https://export.coda.io/signed/out.html.gz");
    expect((download.init?.headers as Record<string, string> | undefined)).toBeUndefined();
  });

  it("exportPage returns a plain (non-gzipped) download as text", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-2", status: "inProgress", href: "h" } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            id: "exp-2",
            status: "complete",
            href: "h",
            downloadLink: "https://export.coda.io/signed/out.html",
          },
        }),
      )
      .mockResolvedValueOnce(fakeDownload({ text: "<p>plain</p>" }));

    const result = await client.exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 });

    expect(result).toBe("<p>plain</p>");
  });

  it("exportPage gunzips a still-compressed body by magic bytes (no content-encoding header)", async () => {
    const { client, fetchMock } = newClient();
    const html = "<p>encoded</p>";
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-3", status: "inProgress", href: "h" } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            id: "exp-3",
            status: "complete",
            href: "h",
            downloadLink: "https://export.coda.io/signed/out.html",
          },
        }),
      )
      // A raw .gz object undici did NOT auto-decode: gzip magic present, no header.
      .mockResolvedValueOnce(fakeDownload({ bytes: gzipSync(Buffer.from(html, "utf8")) }));

    const result = await client.exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 });

    expect(result).toBe(html);
  });

  it("exportPage does NOT double-gunzip an already-decoded body carrying a stale content-encoding:gzip header", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-g", status: "inProgress", href: "h" } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-g", status: "complete", href: "h", downloadLink: "https://export.coda.io/signed/out.html" } }),
      )
      // undici already decompressed the body (plain HTML bytes) but left the header set —
      // trusting the header would gunzip plain text → "incorrect header check".
      .mockResolvedValueOnce(
        fakeDownload({ text: "<p>decoded</p>", headers: { "content-encoding": "gzip" } }),
      );

    const result = await client.exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 });

    expect(result).toBe("<p>decoded</p>");
  });

  it("exportPage keeps polling through the post-202 propagation 404 (request not queryable yet)", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-404", status: "inProgress", href: "h" } }),
      )
      // First status GET 404s ("No request was found …") — must be tolerated, not fatal.
      .mockResolvedValueOnce(fakeResponse({ status: 404, body: { message: "No request was found with the given id, or it has expired." } }))
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-404", status: "complete", href: "h", downloadLink: "https://export.coda.io/signed/out.html" } }),
      )
      .mockResolvedValueOnce(fakeDownload({ text: "<p>recovered</p>" }));

    const result = await client.exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 });

    expect(result).toBe("<p>recovered</p>");
  });

  it("exportPage throws a 502 when the export status is failed", async () => {
    const { client, fetchMock } = newClient();
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ body: { id: "exp-4", status: "inProgress", href: "h" } }),
      )
      .mockResolvedValueOnce(fakeResponse({ body: { id: "exp-4", status: "failed", href: "h" } }));

    const err = (await client
      .exportPage(TOKEN, "doc1", "canvas-1", { pollMs: 1 })
      .catch((e) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toMatchObject({
      error: "coda export failed",
      status: 422,
      requestId: "exp-4",
    });
  });
});
