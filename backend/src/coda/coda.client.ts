import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { CodaRateLimiter } from "./coda-rate-limiter";
import type {
  AwaitMutationOptions,
  CodaDoc,
  CodaMutationResponse,
  CodaMutationStatus,
  CodaPage,
  CodaResource,
  CreatePageInput,
  PageContentInsertionMode,
  ResolveBrowserLinkResponse,
} from "./coda.types";

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
      const status = await this.getMutationStatus(auth, requestId);
      if (status.completed) {
        if (status.warning) {
          this.log.warn(`mutation ${requestId} completed with warning: ${status.warning}`);
        }
        return;
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
        throw new HttpException({ error: "coda api error", status: res.status }, 502);
      }
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
