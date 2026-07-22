import { HttpException } from "@nestjs/common";
import type { CodaAuth, CodaClient } from "../../src/coda/coda.client";
import type {
  CodaMutationResponse,
  CodaPage,
  CreatePageInput,
} from "../../src/coda/coda.types";
import { Rng } from "./rng";

// FakeCoda — a ground-truth model of the Coda REST surface the migration worker
// touches, reproducing the quirks the design's §12.4 reality-check calls out:
//   - createPage returns id+requestId, but the page is NOT queryable until it
//     MATERIALIZES after a random number of polls (H2);
//   - getPageOrNull 404s until materialized, then 200s with a real browserLink;
//   - awaitMutation is async: pending, then completes (or 404-expired = completed);
//   - TRANSIENT infra failures (429 / 503 / 5xx / "unreachable") injected at any
//     step with a probability that RECOVERS after a bounded number of operations;
//   - a parent page used before it EVER materialized is an Invalid-parentPageId
//     (H2 ordering) — recorded as an invariant violation;
//   - EXTERNAL page deletion at random times; an in-place write to a gone page 404s
//     (permanent), and creating under a deleted parent is Invalid-parentPageId.
// It throws the SAME HttpException shapes the real CodaClient throws, so the
// worker's transient-vs-permanent classifier is exercised for real.
//
// GROUND TRUTH is authoritative: `pages` is exactly what "exists in Coda", with the
// content actually written; the harness asserts item/job status against it.

export interface FakePage {
  id: string;
  name: string;
  content: string;
  parentPageId: string | undefined;
  deleted: boolean;
  materialized: boolean;
  // Polls remaining before this page becomes queryable (H2 propagation delay).
  pollsToMaterialize: number;
  // A pre-existing external page (scope root / override target) — always valid.
  external: boolean;
}

export interface FakeCodaConfig {
  // Per-operation probability of a transient failure while faults are active.
  faultProb: number;
  // Faults switch OFF once this many operations have run (guarantees recovery).
  recoverAfterOps: number;
  // Max polls a freshly-created page needs before it materializes.
  maxMaterializePolls: number;
  // Operation counts at which one random existing (non-external) page is deleted.
  externalDeleteAtOps: number[];
}

export class FakeCoda {
  readonly pages = new Map<string, FakePage>();
  // Every page id that has EVER been observed materialized — the legal parent set.
  readonly everMaterialized = new Set<string>();
  // Successful ground-truth createPage calls, keyed by page NAME (unique per source
  // doc). >1 ⇒ a duplicate page was created for one item (idempotency violation).
  readonly createCallsByName = new Map<string, number>();
  // Invariant violations recorded live (e.g. child created under an unmaterialized
  // parent — an H2 ordering bug).
  readonly violations: string[] = [];

  private opCount = 0;
  private nextPageSeq = 0;
  private nextReqSeq = 0;
  private readonly deleteOps: Set<number>;

  constructor(
    private readonly rng: Rng,
    private readonly cfg: FakeCodaConfig,
  ) {
    this.deleteOps = new Set(cfg.externalDeleteAtOps);
  }

  // Register a pre-existing external page (a scope root or an override target) —
  // always valid as a parent and immediately queryable.
  registerExistingPage(pageId: string, name: string): void {
    this.pages.set(pageId, {
      id: pageId,
      name,
      content: "",
      parentPageId: undefined,
      deleted: false,
      materialized: true,
      pollsToMaterialize: 0,
      external: true,
    });
    this.everMaterialized.add(pageId);
  }

  // --- CodaClient surface ---------------------------------------------------

  createPage(
    _auth: CodaAuth,
    _docId: string,
    input: CreatePageInput,
  ): Promise<CodaMutationResponse> {
    this.step();
    // A transient failure is ATOMIC: the create request never took effect, so no
    // ghost page is left behind (the real client raises before/without a 202 it can
    // persist an id from). Models a fetch that rejects or a 5xx on the enqueue.
    this.maybeTransient("createPage");

    // Parent validity (H2): the parent must have materialized at least once. Using a
    // never-materialized page as parent is the ordering bug we must never commit.
    if (input.parentPageId !== undefined) {
      const parent = this.pages.get(input.parentPageId);
      if (!this.everMaterialized.has(input.parentPageId)) {
        this.violations.push(
          `createPage used parent ${input.parentPageId} that never materialized (H2 ordering)`,
        );
        throw permanent(400, "Invalid parentPageId: not found");
      }
      // Materialized once but since externally deleted → Coda rejects (acceptable,
      // not a worker bug): the child fails for real.
      if (parent?.deleted) {
        throw permanent(400, "Invalid parentPageId: page deleted");
      }
    }

    const id = `page_${this.nextPageSeq++}`;
    this.pages.set(id, {
      id,
      name: input.name,
      content: input.html,
      parentPageId: input.parentPageId,
      deleted: false,
      materialized: false,
      pollsToMaterialize: this.rng.int(0, this.cfg.maxMaterializePolls),
      external: false,
    });
    this.createCallsByName.set(
      input.name,
      (this.createCallsByName.get(input.name) ?? 0) + 1,
    );
    return Promise.resolve({ id, requestId: this.reqId() });
  }

  replacePageContent(
    _auth: CodaAuth,
    _docId: string,
    pageId: string,
    html: string,
  ): Promise<CodaMutationResponse> {
    this.step();
    this.maybeTransient("replacePageContent");
    const page = this.pages.get(pageId);
    if (!page || page.deleted) {
      // In-place write to a gone page → permanent 404 (this is how an externally
      // deleted page ultimately fails a retrying item for real, no infinite loop).
      throw permanent(404, "page not found");
    }
    page.content = html;
    return Promise.resolve({ id: pageId, requestId: this.reqId() });
  }

  appendPageContent(
    _auth: CodaAuth,
    _docId: string,
    pageId: string,
    html: string,
  ): Promise<CodaMutationResponse> {
    this.step();
    this.maybeTransient("appendPageContent");
    const page = this.pages.get(pageId);
    if (!page || page.deleted) {
      throw permanent(404, "page not found");
    }
    page.content += html;
    return Promise.resolve({ id: pageId, requestId: this.reqId() });
  }

  // The worker awaits a mutation to "completed" before descending. Model it as an
  // async op that may blip transiently, then completes (a 404 on the status record
  // is ALSO completion — the real client treats mutationStatus-404 as done).
  awaitMutation(_auth: CodaAuth, _requestId: string): Promise<void> {
    this.step();
    this.maybeTransient("awaitMutation");
    return Promise.resolve();
  }

  getPageOrNull(
    _auth: CodaAuth,
    _docId: string,
    pageId: string,
  ): Promise<CodaPage | null> {
    this.step();
    this.maybeTransient("getPage");
    const page = this.pages.get(pageId);
    if (!page || page.deleted) return Promise.resolve(null);
    if (!page.materialized) {
      if (page.pollsToMaterialize <= 0) {
        page.materialized = true;
        this.everMaterialized.add(page.id);
      } else {
        page.pollsToMaterialize--;
        return Promise.resolve(null); // 404: not queryable yet (H2)
      }
    }
    return Promise.resolve(this.toCodaPage(page));
  }

  async getPage(
    auth: CodaAuth,
    docId: string,
    pageId: string,
  ): Promise<CodaPage> {
    const page = await this.getPageOrNull(auth, docId, pageId);
    if (!page) throw permanent(404, "page not found");
    return page;
  }

  // --- Introspection for the harness ----------------------------------------

  livePages(): FakePage[] {
    return [...this.pages.values()].filter((p) => !p.deleted && !p.external);
  }

  // --- Internals ------------------------------------------------------------

  private toCodaPage(page: FakePage): CodaPage {
    return {
      id: page.id,
      name: page.name,
      browserLink: `https://coda.io/d/sim/_su${page.id}`,
    };
  }

  private reqId(): string {
    return `req_${this.nextReqSeq++}`;
  }

  // Advance the logical clock and fire any scheduled external delete for this op.
  private step(): void {
    this.opCount++;
    if (this.deleteOps.has(this.opCount)) {
      const live = this.livePages();
      if (live.length > 0) {
        const victim = this.rng.pick(live);
        victim.deleted = true;
      }
    }
  }

  // Inject a transient infra failure with the configured probability while faults
  // are still active. Throws the exact HttpException shapes the real CodaClient
  // raises so the worker's transient classifier runs for real.
  private maybeTransient(_where: string): void {
    if (this.opCount > this.cfg.recoverAfterOps) return;
    if (!this.rng.chance(this.cfg.faultProb)) return;
    const kind = this.rng.int(0, 3);
    switch (kind) {
      case 0:
        throw new HttpException({ error: "coda unreachable" }, 502);
      case 1:
        throw new HttpException({ error: "coda rate limited" }, 429);
      case 2:
        // Upstream 5xx surfaced by the client wrapper (status >= 500 = transient).
        throw new HttpException(
          { error: "coda api error", status: 503, body: "service unavailable" },
          502,
        );
      default:
        throw new HttpException({ error: "coda mutation timed out" }, 504);
    }
  }
}

// Build a permanent Coda 4xx exactly as CodaClient wraps a non-ok upstream response.
function permanent(status: number, body: string): HttpException {
  return new HttpException({ error: "coda api error", status, body }, 502);
}

// Compile-time proof the fake satisfies the subset of CodaClient the worker calls.
export type WorkerCodaSurface = Pick<
  CodaClient,
  | "createPage"
  | "replacePageContent"
  | "appendPageContent"
  | "awaitMutation"
  | "getPageOrNull"
  | "getPage"
>;
const _typecheck: (c: FakeCoda) => WorkerCodaSurface = (c) => c;
void _typecheck;
