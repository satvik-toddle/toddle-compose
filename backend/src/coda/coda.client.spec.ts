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

  it("awaitMutation throws 504 when the deadline passes", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ body: { completed: false } }));

    await expect(
      client.awaitMutation(TOKEN, "req-1", { pollMs: 5, timeoutMs: 30 }),
    ).rejects.toMatchObject({ status: 504 });
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

  it("maps a non-429 upstream error to a 502", async () => {
    const { client, fetchMock } = newClient();
    fetchMock.mockResolvedValue(fakeResponse({ status: 400, body: "bad request detail" }));

    await expect(client.getPage(TOKEN, "doc1", "canvas-1")).rejects.toMatchObject({ status: 502 });
  });
});
