import { gunzipSync } from "node:zlib";
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { CodaRateLimiter } from "./coda-rate-limiter";
import type {
  AwaitMutationOptions,
  CodaDoc,
  CodaExportBegin,
  CodaExportStatus,
  CodaMutationResponse,
  CodaMutationStatus,
  CodaPage,
  CodaPageList,
  CodaResource,
  CreatePageInput,
  ExportPageOptions,
  PageContentInsertionMode,
  ResolveBrowserLinkResponse,
} from "./coda.types";

// Defensive ceiling on the pages-list pagination loop (H6): stops a malformed
// nextPageToken from looping forever. 100 pages/request × 50 requests = 5000 pages.
const MAX_PAGE_LIST_REQUESTS = 50;

// Thin HTTP client for the Coda REST API. Mirrors RtcInternalClient: native
// fetch, AbortSignal.timeout, network failure → 502, truncated upstream-body
// logging. Tokens are supplied by the caller (plaintext, already decrypted from
// the DB by a later credentials phase) — the client never reads a global token.
// A caller may pass a SINGLE token or a POOL (a destination's token set); the
// limiter picks the least-loaded token for each call. Every mutating call goes
// through the write pacer, every read through the read pacer; 429/503 honor
// Retry-After dynamically (per-token) and retry to a configurable max.

// One token, or a destination's token pool to distribute load across (H1).
export type CodaAuth = string | string[];

type CallKind = "read" | "write";

@Injectable()
export class CodaClient {
  private readonly log = new Logger("CodaClient");

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly limiter: CodaRateLimiter,
  ) {}

  // --- Public API (consumed by later migration phases) ----------------------

  // Resolve a browser URL to its Coda resource. Caller asserts type==="page" (H5).
  async resolveBrowserLink(auth: CodaAuth, url: string): Promise<CodaResource> {
    const qs = new URLSearchParams({ url, degradeGracefully: "true" });
    const body = await this.call<ResolveBrowserLinkResponse>(
      "read",
      auth,
      "GET",
      `/resolveBrowserLink?${qs.toString()}`,
    );
    return body.resource;
  }

  // Fetch a doc's metadata; used to confirm a token can access a whole-doc scope.
  getDoc(auth: CodaAuth, docId: string): Promise<CodaDoc> {
    return this.call<CodaDoc>("read", auth, "GET", `/docs/${enc(docId)}`);
  }

  // Fetch a page's metadata; only the immediate `parent` is present (no ancestry, H6).
  getPage(auth: CodaAuth, docId: string, pageId: string): Promise<CodaPage> {
    return this.call<CodaPage>(
      "read",
      auth,
      "GET",
      `/docs/${enc(docId)}/pages/${enc(pageId)}`,
    );
  }

  // Like getPage, but returns null on a 404 instead of throwing. A freshly-created
  // page 404s until Coda finishes materializing it (H2); the materialization poll
  // uses null to mean "not ready yet, keep polling" vs. a real error (rethrown).
  async getPageOrNull(
    auth: CodaAuth,
    docId: string,
    pageId: string,
  ): Promise<CodaPage | null> {
    try {
      return await this.getPage(auth, docId, pageId);
    } catch (err) {
      if (
        err instanceof HttpException &&
        (err.getResponse() as { status?: number })?.status === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  // List every page in a doc (flat). The caller rebuilds the tree from each
  // page's `parent` ref (H6). Follows nextPageToken until absent, capped so a
  // malformed token can't loop forever. onProgress (optional) is invoked after
  // each page-batch with the cumulative page count, for live progress reporting.
  // onBatch (optional, awaited) receives each batch as it arrives so a caller can
  // persist items incrementally while listing is still in flight.
  async listPages(
    auth: CodaAuth,
    docId: string,
    onProgress?: (fetchedCount: number) => void,
    onBatch?: (batch: CodaPage[], fetchedCount: number) => Promise<void> | void,
  ): Promise<CodaPage[]> {
    const pages: CodaPage[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < MAX_PAGE_LIST_REQUESTS; i++) {
      // Coda rejects any other query param alongside pageToken (the cursor is
      // self-contained): send limit only on the first request, the token alone after.
      const qs = new URLSearchParams();
      if (pageToken) qs.set("pageToken", pageToken);
      else qs.set("limit", "100");
      const body = await this.call<CodaPageList>(
        "read",
        auth,
        "GET",
        `/docs/${enc(docId)}/pages?${qs.toString()}`,
      );
      const batch = body.items ?? [];
      pages.push(...batch);
      onProgress?.(pages.length);
      await onBatch?.(batch, pages.length);
      if (!body.nextPageToken) return pages;
      pageToken = body.nextPageToken;
    }
    this.log.warn(
      `listPages(${docId}) hit the ${MAX_PAGE_LIST_REQUESTS}-request cap; returning ${pages.length} pages (list may be truncated)`,
    );
    return pages;
  }

  // Export a page's content as HTML. Coda's export is async: begin → poll → the
  // completed status carries a signed downloadLink we fetch directly (NOT through
  // the API base/auth/pacer). The begin POST creates an export request but does
  // not mutate the doc, so it is paced as a READ. The download body may be gzipped.
  async exportPage(
    auth: CodaAuth,
    docId: string,
    pageId: string,
    opts: ExportPageOptions = {},
  ): Promise<string> {
    const begin = await this.call<CodaExportBegin>(
      "read",
      auth,
      "POST",
      `/docs/${enc(docId)}/pages/${enc(pageId)}/export`,
      { outputFormat: "html" },
    );
    const requestId = begin.id;
    const statusPath = `/docs/${enc(docId)}/pages/${enc(pageId)}/export/${enc(requestId)}`;

    const timeoutMs = opts.timeoutMs ?? 120_000;
    let pollMs = opts.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    let downloadLink: string | undefined;
    for (;;) {
      // The begin POST returns 202; the request record isn't queryable for a short
      // propagation window, so an early status GET 404s ("No request was found …").
      // Treat that 404 as "not ready yet" and keep polling — NOT a failure (throwing
      // here would fail the export before it ever materializes).
      let status: CodaExportStatus | null = null;
      try {
        status = await this.call<CodaExportStatus>("read", auth, "GET", statusPath);
      } catch (err) {
        if (
          !(err instanceof HttpException) ||
          (err.getResponse() as { status?: number })?.status !== 404
        ) {
          throw err;
        }
      }
      if (status?.status === "failed") {
        this.log.warn(`export ${requestId} failed on Coda's side`);
        throw new HttpException(
          { error: "coda export failed", status: 422, requestId },
          502,
        );
      }
      if (status?.status === "complete") {
        downloadLink = status.downloadLink;
        break;
      }
      if (Date.now() + pollMs >= deadline) {
        throw new HttpException({ error: "coda export timed out", requestId }, 504);
      }
      await sleep(pollMs);
      pollMs = Math.min(pollMs * 1.5, 5_000);
    }
    if (!downloadLink) {
      throw new HttpException(
        { error: "coda export completed without a downloadLink", requestId },
        502,
      );
    }
    return this.downloadExport(downloadLink);
  }

  // Fetch a completed export's signed URL directly (bypasses call() — it is a
  // GCS/S3-style URL, not the Coda API base, so no auth/pacer). Coda serves the
  // object with `content-encoding: gzip`, which undici's fetch AUTO-DECOMPRESSES —
  // so we can't trust the header. Sniff the gzip magic bytes instead: gunzip only a
  // genuine still-compressed object (e.g. a .gz served as octet-stream that undici
  // left alone), otherwise the bytes are already decompressed HTML.
  private async downloadExport(downloadLink: string): Promise<string> {
    const timeoutMs = this.config.get("CODA_REQUEST_TIMEOUT_MS", { infer: true });
    let res: Response;
    try {
      res = await fetch(downloadLink, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      this.log.warn("export download → network failure (signed url unreachable)");
      throw new HttpException({ error: "coda export download unreachable" }, 502);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.log.warn(`export download → ${res.status}: ${text.slice(0, 300)}`);
      throw new HttpException(
        { error: "coda export download error", status: res.status },
        502,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    return (isGzip ? gunzipSync(buf) : buf).toString("utf8");
  }

  // Create a page from constrained HTML (H4). Async: returns a requestId to gate on (H2).
  createPage(
    auth: CodaAuth,
    docId: string,
    input: CreatePageInput,
  ): Promise<CodaMutationResponse> {
    const body: Record<string, unknown> = {
      name: input.name,
      pageContent: {
        type: "canvas",
        canvasContent: { format: "html", content: input.html },
      },
    };
    if (input.subtitle !== undefined) body.subtitle = input.subtitle;
    if (input.parentPageId !== undefined) body.parentPageId = input.parentPageId;
    return this.call<CodaMutationResponse>(
      "write",
      auth,
      "POST",
      `/docs/${enc(docId)}/pages`,
      body,
    );
  }

  // Wholesale replace of a page's canvas content (override = replace, no diff).
  replacePageContent(
    auth: CodaAuth,
    docId: string,
    pageId: string,
    html: string,
  ): Promise<CodaMutationResponse> {
    return this.updatePageContent(auth, docId, pageId, html, "replace");
  }

  // Append canvas content — used to stream oversized docs in chunks (H8).
  appendPageContent(
    auth: CodaAuth,
    docId: string,
    pageId: string,
    html: string,
  ): Promise<CodaMutationResponse> {
    return this.updatePageContent(auth, docId, pageId, html, "append");
  }

  private updatePageContent(
    auth: CodaAuth,
    docId: string,
    pageId: string,
    html: string,
    insertionMode: PageContentInsertionMode,
  ): Promise<CodaMutationResponse> {
    return this.call<CodaMutationResponse>(
      "write",
      auth,
      "PUT",
      `/docs/${enc(docId)}/pages/${enc(pageId)}`,
      {
        contentUpdate: {
          insertionMode,
          canvasContent: { format: "html", content: html },
        },
      },
    );
  }

  getMutationStatus(
    auth: CodaAuth,
    requestId: string,
  ): Promise<CodaMutationStatus> {
    return this.call<CodaMutationStatus>(
      "read",
      auth,
      "GET",
      `/mutationStatus/${enc(requestId)}`,
    );
  }

  // Poll getMutationStatus until completed or timeout. Gates a create before we
  // descend to child pages (H2) — content import is async with size-correlated
  // propagation delay. Poll interval backs off exponentially up to a 5s cap.
  async awaitMutation(
    auth: CodaAuth,
    requestId: string,
    opts: AwaitMutationOptions = {},
  ): Promise<void> {
    const timeoutMs =
      opts.timeoutMs ??
      this.config.get("CODA_MUTATION_TIMEOUT_MS", { infer: true }) ??
      180_000;
    let pollMs =
      opts.pollMs ??
      this.config.get("CODA_MUTATION_POLL_MS", { infer: true }) ??
      500;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const status = await this.getMutationStatus(auth, requestId);
        if (status.completed) {
          // A non-null warning means the mutation FAILED on Coda's side (coda.types.ts):
          // throw so the item is marked FAILED, never falsely SUCCEEDED. Shaped so the
          // worker classifies it PERMANENT (status 422 < 500, distinct error string) —
          // a content/import rejection won't fix itself on retry.
          if (status.warning) {
            this.log.warn(`mutation ${requestId} failed on Coda's side: ${status.warning}`);
            throw new HttpException(
              { error: "coda mutation failed", status: 422, body: status.warning },
              502,
            );
          }
          return;
        }
      } catch (err) {
        // Coda GCs a mutation's status record once it completes, so a 404 on the
        // mutationStatus path means the mutation ALREADY completed (and expired) —
        // treat it as done. Anything else is a real failure and rethrows.
        if (err instanceof HttpException && (err.getResponse() as { status?: number })?.status === 404) {
          return;
        }
        throw err;
      }
      if (Date.now() + pollMs >= deadline) {
        throw new HttpException(
          { error: "coda mutation timed out", requestId },
          504,
        );
      }
      await sleep(pollMs);
      pollMs = Math.min(pollMs * 1.5, 5_000);
    }
  }

  // --- Transport ------------------------------------------------------------

  private base(): string {
    return this.config.get("CODA_API_BASE_URL", { infer: true });
  }

  private async acquire(kind: CallKind, tokens: string[]): Promise<string> {
    return kind === "write"
      ? this.limiter.acquireWriteFromPool(tokens)
      : this.limiter.acquireReadFromPool(tokens);
  }

  private penalize(kind: CallKind, token: string, retryMs: number): void {
    if (kind === "write") this.limiter.penalizeWrite(token, retryMs);
    else this.limiter.penalizeRead(token, retryMs);
  }

  private async call<T>(
    kind: CallKind,
    auth: CodaAuth,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const tokens = Array.isArray(auth) ? auth : [auth];
    if (tokens.length === 0) {
      throw new HttpException({ error: "no Coda API token configured" }, 500);
    }
    const timeoutMs = this.config.get("CODA_REQUEST_TIMEOUT_MS", { infer: true });
    const maxRetries = this.config.get("CODA_MAX_RETRIES", { infer: true });

    for (let attempt = 0; ; attempt++) {
      // Pool pick + slot reservation happen together; the returned token is the
      // one to authenticate with (and to penalize on a 429).
      const token = await this.acquire(kind, tokens);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      let res: Response;
      try {
        res = await fetch(`${this.base()}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        this.log.warn(`${method} ${path} → network failure (coda unreachable)`);
        throw new HttpException({ error: "coda unreachable" }, 502);
      }

      // Adaptive backoff: park THIS token past Retry-After, then re-acquire — a
      // pooled retry reroutes to a token that isn't cooling down (H1).
      if (res.status === 429 || res.status === 503) {
        const retryMs =
          parseRetryAfter(res.headers.get("retry-after")) ?? backoffMs(attempt);
        this.penalize(kind, token, retryMs);
        if (attempt >= maxRetries) {
          this.log.warn(`${method} ${path} → ${res.status} exhausted ${maxRetries} retries`);
          throw new HttpException({ error: "coda rate limited" }, 429);
        }
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        this.log.warn(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
        throw new HttpException(
          { error: "coda api error", status: res.status, body: text.slice(0, 300) },
          502,
        );
      }
      // Consistent per-request trace: method/path/status (debug so it's off by
      // default but greppable when the migration worker's DEBUG logs are enabled).
      this.log.debug(`${method} ${path} → ${res.status}`);
      return (text ? JSON.parse(text) : {}) as T;
    }
  }
}

const enc = encodeURIComponent;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Retry-After is either delta-seconds or an HTTP date. Returns ms, or null.
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

// Exponential backoff floor when no Retry-After header is supplied.
function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}
