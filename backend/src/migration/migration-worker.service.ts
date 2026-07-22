import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@app/database";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { CodaClient } from "../coda/coda.client";
import type { CodaPage } from "../coda/coda.types";
import { CodaCredentialsService } from "./coda-credentials.service";
import { NON_TERMINAL_JOB_STATUSES } from "./job-status";

// Quoted SQL literal list ('QUEUED', 'RUNNING') for the raw status IN (...) clauses.
// Values are compile-time constants, so a raw splice is injection-safe and keeps the
// generated SQL byte-identical (no text→enum param coercion).
const LIVE_JOB_STATUS_SQL = Prisma.raw(
  NON_TERMINAL_JOB_STATUSES.map((s) => `'${s}'`).join(", "),
);

// Phase 4c — the durable, fault-tolerant background worker that pushes docs into
// Coda. Modeled on the rtc compaction scheduler (OnApplicationBootstrap +
// self-re-arming, unref'd setTimeout, resume-from-DB on boot), PLUS the real
// lease/claim + per-item retry that compaction lacks (D9). All progress is in
// Postgres, so a crash/restart resumes exactly where it left off:
//   - claim is an atomic conditional UPDATE with FOR UPDATE SKIP LOCKED (D9) →
//     never double-processes, reclaims RUNNING items whose lease expired;
//   - codaPageId is persisted the instant a page is created, before the async
//     mutation is awaited (C3) → a crash mid-poll never duplicates on resume;
//   - a deleted/unreadable/empty source is SKIPPED, never pushed (D7).

// A ready item, claimed by the atomic UPDATE (camelCase-aliased in RETURNING).
interface ClaimedItem {
  id: string;
  jobId: string;
  sourceDocId: string;
  plannedParentDocId: string | null;
  title: string;
  targetCodaPageId: string | null;
  override: boolean;
  codaPageId: string | null;
  migratedSeq: number | null;
  // Point-in-time content FROZEN at enqueue — pushed verbatim, never re-extracted at run (D2).
  // null/empty = empty doc at enqueue → skipped.
  snapshotHtml: string | null;
  // Head seq captured alongside the snapshot at enqueue; recorded as migratedSeq (D1/D2).
  enqueuedSeq: number | null;
  // PERMANENT-error retry count (checked against maxAttempts).
  attempts: number;
  // TRANSIENT-error retry count (checked against maxTransientAttempts) — a separate
  // budget so burned transient retries never starve the permanent-error retries.
  transientAttempts: number;
  seq: number;
}

// A created/reused Coda page + the requestId to gate on (null when resumed with no
// pending mutation). null (not this shape) = the item was terminated mid-flight → abort.
interface BuiltPage {
  codaPageId: string;
  requestId: string | null;
}

const PENDING_OR_RUNNING = ["PENDING", "RUNNING"] as const;
// lastError stamped on a descendant cascade-skipped because its parent ended
// terminally. A transient/parent-failure skip (recoverable on retry), distinct from
// an intentional skip — so it forces PARTIAL, not SUCCEEDED. MUST match the literal
// in skipOrphansOfTerminalParents' SQL and the retry re-drive predicate.
export const PARENT_SKIP_REASON = "parent did not migrate";
// The ONLY "clean" skip reason: the source doc was genuinely empty at enqueue, so
// there was nothing to migrate — a no-op that does NOT taint a SUCCEEDED job. EVERY
// other skip (unreadable/deleted source, destination removed, orphaned-on-terminal-
// parent) means a SELECTED doc could not be migrated and MUST keep the job off
// SUCCEEDED (finalization treats it as "tainting"). Keeps status == reality.
export const EMPTY_SKIP_REASON = "source is empty";
// Thrown by awaitMaterialization when a just-created page is not yet queryable
// within the poll budget. Classified TRANSIENT (below) so it retries WITHOUT
// burning the attempt budget — Coda materializes with a size-correlated delay, so
// "not ready yet" is a self-healing condition, never a permanent failure. If the
// page was instead externally deleted, the next attempt's in-place replace hits a
// permanent Coda 404 and the item fails for real — so this never loops forever.
export const NOT_MATERIALIZED_ERROR = "coda page not materialized";
// The create tx wraps a Coda write (create/replace) which is paced, so allow it
// generous headroom over Prisma's 5s interactive-tx default — but NOT the slow
// awaitMutation, which runs outside the lock (C3).
const CREATE_TX_TIMEOUT_MS = 30_000;

@Injectable()
export class MigrationWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger("MigrationWorker");
  private timer: NodeJS.Timeout | null = null;
  private interval = 0;
  private armed = false;
  private stopped = false;
  private ticking = false;

  // Identifies this process as the lease holder; unique per instance.
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly leaseTtlMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly maxTransientAttempts: number;
  private readonly maxHtmlBytes: number;
  private readonly materializeTimeoutMs: number;
  private readonly materializePollMs: number;
  // Base backoff before re-releasing a transient-failed item to PENDING; grows
  // exponentially per attempt (capped) so a downed dependency (rtc restarting) is
  // ridden out rather than hot-looped. Mutable so tests can zero it out.
  private transientBackoffMs = 3_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    // forwardRef: DocumentsService ↔ MigrationWorkerService form a module cycle
    // (DocumentsService.remove calls maybeFinalizeJob after a delete).
    @Inject(forwardRef(() => DocumentsService))
    private readonly documents: DocumentsService,
    private readonly coda: CodaClient,
    private readonly credentials: CodaCredentialsService,
  ) {
    this.leaseTtlMs = this.config.get("MIGRATION_LEASE_TTL_MS", { infer: true });
    this.batchSize = this.config.get("MIGRATION_BATCH_SIZE", { infer: true });
    this.maxAttempts = this.config.get("MIGRATION_MAX_ITEM_ATTEMPTS", {
      infer: true,
    });
    this.maxTransientAttempts = this.config.get(
      "MIGRATION_MAX_TRANSIENT_ATTEMPTS",
      { infer: true },
    );
    this.maxHtmlBytes = this.config.get("CODA_MAX_HTML_BYTES", { infer: true });
    this.materializeTimeoutMs = this.config.get("CODA_MATERIALIZE_TIMEOUT_MS", {
      infer: true,
    });
    this.materializePollMs = this.config.get("CODA_MATERIALIZE_POLL_MS", {
      infer: true,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.interval = this.config.get("MIGRATION_WORKER_INTERVAL_MS", {
      infer: true,
    });
    if (this.interval <= 0) {
      this.log.log("migration worker disabled (MIGRATION_WORKER_INTERVAL_MS<=0)");
      return;
    }

    // Boot-recovery is inherent in the claim (expired-lease reclaim + QUEUED/RUNNING
    // re-drive); just log a one-line summary of what will be reclaimed (D9).
    try {
      const reclaimable = await this.prisma.migrationJobItem.count({
        where: { status: "RUNNING", leasedUntil: { lt: new Date() } },
      });
      if (reclaimable > 0) {
        this.log.warn(
          `boot recovery: ${reclaimable} RUNNING item(s) with an expired lease will be reclaimed`,
        );
      }
    } catch (e) {
      // A bookkeeping read must never abort boot; the tick will surface real errors.
      this.log.error("boot-recovery count failed (continuing)", e as Error);
    }
    if (this.stopped) return;

    this.armed = true;
    this.log.log(
      `migration worker armed: interval=${this.interval}ms worker=${this.workerId}`,
    );
    this.schedule(this.interval);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.armed) this.log.log("migration worker stopped");
  }

  // One self-re-arming timer: each pass awaits before re-arming, so passes never
  // overlap. unref'd so a pending timer never keeps the process alive on shutdown.
  private schedule(delay: number): void {
    this.timer = setTimeout(async () => {
      await this.tick().catch((e) => this.log.error("migration tick failed", e));
      if (!this.stopped) this.schedule(this.interval);
    }, delay);
    this.timer.unref?.();
  }

  // Claim and process ready items until none remain, then let the timer re-arm.
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (;;) {
        if (this.stopped) return;
        const items = await this.claimBatch();
        if (items.length === 0) {
          // Nothing claimable: some PENDING items may be permanently blocked on a
          // parent that ended terminally (FAILED/SKIPPED) and thus can never be
          // placed. Cascade-skip that blocked subtree so its job finalizes instead
          // of deadlocking on forever-PENDING items; then finalize affected jobs.
          const jobIds = await this.skipOrphansOfTerminalParents();
          if (jobIds.length === 0) return;
          for (const jobId of jobIds) {
            if (this.stopped) return;
            await this.maybeFinalizeJob(jobId).catch((e) =>
              this.log.error(`finalize job ${jobId} failed`, e as Error),
            );
          }
          continue;
        }
        // Process the claimed batch CONCURRENTLY so independent items overlap their
        // (tens-of-seconds) awaitMutation / awaitMaterialization waits instead of
        // serializing them. Safe: the CodaRateLimiter still serializes real writes to
        // ≤5/10s per token, the per-(sourceDocId,scopeId) advisory lock prevents
        // double-creates, and the readiness gate keeps a child out of the same batch
        // as its not-yet-SUCCEEDED parent — so ordering + idempotency are unchanged.
        // (processItem swallows its own errors, so Promise.all never rejects.)
        // NOTE: true throughput scales with the TOKEN POOL (N tokens ≈ N× writes);
        // the concurrency + fast tick only ensure we use the full 5/10s write budget
        // and overlap the non-write materialization polls.
        if (this.stopped) return;
        await Promise.all(items.map((item) => this.processItem(item)));
      }
    } finally {
      this.ticking = false;
    }
  }

  // --- The integrity core: atomic lease claim (D9) --------------------------
  // A single conditional UPDATE flips a batch of READY items to RUNNING under
  // this worker's lease. READY = the job is live (QUEUED/RUNNING) AND the item is
  // PENDING (or RUNNING with an expired lease — crash reclaim) AND its parent is
  // materialized (no planned parent, or the sibling item with that sourceDocId has
  // status='SUCCEEDED'). Gating on the parent being SUCCEEDED — not merely having a
  // codaPageId (persisted at 202, before awaitMutation confirms materialization) —
  // stops a child racing ahead of a parent page Coda hasn't finished creating yet.
  // OVERRIDE items (update-existing) replace a pre-existing page in place and never
  // use the parent, so they bypass the gate and run as soon as a slot frees up.
  // Survives restart, because parent state is read from the DB, not memory.
  // FOR UPDATE ... SKIP LOCKED + the lease guarantee no item is ever taken twice.
  private async claimBatch(): Promise<ClaimedItem[]> {
    const leasedUntil = new Date(Date.now() + this.leaseTtlMs);
    return this.prisma.$queryRaw<ClaimedItem[]>`
      UPDATE migration_job_items i
      SET status = 'RUNNING',
          leased_by = ${this.workerId},
          leased_until = ${leasedUntil},
          updated_at = now()
      WHERE i.id IN (
        SELECT c.id
        FROM migration_job_items c
        JOIN migration_jobs j ON j.id = c.job_id
        WHERE j.status IN (${LIVE_JOB_STATUS_SQL})
          AND (
            c.status = 'PENDING'
            OR (c.status = 'RUNNING' AND c.leased_until IS NOT NULL AND c.leased_until < now())
          )
          AND (
            c.override
            OR c.planned_parent_doc_id IS NULL
            OR EXISTS (
              SELECT 1 FROM migration_job_items p
              WHERE p.job_id = c.job_id
                AND p.source_doc_id = c.planned_parent_doc_id
                AND p.status = 'SUCCEEDED'
            )
          )
        ORDER BY c.job_id, c.seq
        FOR UPDATE OF c SKIP LOCKED
        LIMIT ${this.batchSize}
      )
      RETURNING
        i.id,
        i.job_id AS "jobId",
        i.source_doc_id AS "sourceDocId",
        i.planned_parent_doc_id AS "plannedParentDocId",
        i.title,
        i.target_coda_page_id AS "targetCodaPageId",
        i.override,
        i.coda_page_id AS "codaPageId",
        i.migrated_seq AS "migratedSeq",
        i.snapshot_html AS "snapshotHtml",
        i.enqueued_seq AS "enqueuedSeq",
        i.attempts,
        i.transient_attempts AS "transientAttempts",
        i.seq
    `;
  }

  // A child is claimable only once its parent item is SUCCEEDED. If a planned
  // parent instead ends terminally (FAILED/SKIPPED), its descendants can never be
  // placed — a recursive CTE walks the plannedParentDocId chain within each live
  // job and flips the whole blocked subtree PENDING → SKIPPED so the job can
  // finalize. OVERRIDE items are never blocked (they bypass the parent gate), so
  // they are excluded at both CTE levels. Returns the affected jobIds (for
  // finalization); idempotent (guarded on status='PENDING').
  private async skipOrphansOfTerminalParents(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ jobId: string }[]>`
      WITH RECURSIVE blocked AS (
        SELECT c.id, c.job_id, c.source_doc_id
        FROM migration_job_items c
        JOIN migration_jobs j ON j.id = c.job_id
        JOIN migration_job_items p
          ON p.job_id = c.job_id AND p.source_doc_id = c.planned_parent_doc_id
        WHERE j.status IN (${LIVE_JOB_STATUS_SQL})
          AND c.status = 'PENDING'
          AND NOT c.override
          AND c.planned_parent_doc_id IS NOT NULL
          AND p.status IN ('FAILED', 'SKIPPED')
        UNION
        SELECT c.id, c.job_id, c.source_doc_id
        FROM migration_job_items c
        JOIN blocked b
          ON c.job_id = b.job_id AND c.planned_parent_doc_id = b.source_doc_id
        WHERE c.status = 'PENDING'
          AND NOT c.override
      )
      UPDATE migration_job_items i
      SET status = 'SKIPPED',
          last_error = 'parent did not migrate',
          leased_by = NULL,
          leased_until = NULL,
          updated_at = now()
      FROM blocked b
      WHERE i.id = b.id AND i.status = 'PENDING'
      RETURNING i.job_id AS "jobId"
    `;
    if (rows.length === 0) return [];
    const perJob = new Map<string, number>();
    for (const r of rows) perJob.set(r.jobId, (perJob.get(r.jobId) ?? 0) + 1);
    for (const [jobId, count] of perJob) {
      await this.prisma.migrationJob
        .update({ where: { id: jobId }, data: { skippedItems: { increment: count } } })
        .catch((e) => this.log.error(`bumping skippedItems for job ${jobId} failed`, e as Error));
    }
    this.log.warn(
      `cascade-skipped ${rows.length} item(s) blocked on a terminal parent across ${perJob.size} job(s)`,
    );
    return [...perJob.keys()];
  }

  // --- Per-item execution ---------------------------------------------------
  private async processItem(item: ClaimedItem): Promise<void> {
    // Greppable per-item context: reconstruct any item's fate from the logs alone.
    const ctx = `[job=${item.jobId} item=${item.id} src=${item.sourceDocId} seq=${item.seq} attempt=${item.attempts + 1}/t${item.transientAttempts + 1}]`;
    // The step in progress, surfaced on failure so a lastError pins WHERE it broke.
    let step = "claim";
    this.log.log(
      `${ctx} claimed lease=${this.leaseTtlMs}ms override=${item.override} target=${item.targetCodaPageId ?? "-"} resumePage=${item.codaPageId ?? "-"}`,
    );
    try {
      step = "load-job";
      const job = await this.prisma.migrationJob.findUnique({
        where: { id: item.jobId },
      });
      // (a) respect cancel, and quietly abandon a vanished job/scope (D8).
      if (!job || job.status === "CANCELED") {
        this.log.log(`${ctx} terminal=SKIPPED reason=job-canceled-or-gone`);
        await this.finishItem(item, "SKIPPED", "job canceled");
        return;
      }
      await this.markJobStarted(job.id);

      // (b) run-time permission re-check (P2) + source existence (D7): a doc that
      // was deleted or had its grant revoked since enqueue is SKIPPED, never pushed.
      step = "assert-readable";
      try {
        await this.documents.assertReadable(job.createdById, item.sourceDocId);
      } catch {
        this.log.log(`${ctx} terminal=SKIPPED reason=source-not-readable`);
        await this.finishItem(item, "SKIPPED", "source not readable at run time");
        return;
      }

      // (c) resolve the Coda destination + parent page.
      step = "resolve-scope";
      const scope = await this.prisma.migrationScope.findFirst({
        where: { id: job.scopeId, deletedAt: null },
        select: { codaDocId: true, codaRootPageId: true },
      });
      if (!scope) {
        this.log.log(`${ctx} terminal=SKIPPED reason=destination-removed`);
        await this.finishItem(item, "SKIPPED", "destination removed");
        return;
      }
      // An override replaces its OWN target page in place — it's never placed under a
      // parent, so it needs no parent resolution (and, running un-gated, its parent
      // item may not be SUCCEEDED yet). Only a fresh create nests under a parent.
      step = "resolve-parent";
      const parentPageId = item.override
        ? undefined
        : await this.resolveCodaParent(item, scope.codaRootPageId);

      // (d) point-in-time content: push the HTML FROZEN at enqueue verbatim — never
      // re-extract at run, so later edits/compaction (and a transient rtc outage) can't
      // change what gets migrated (D2). A null/empty snapshot = the doc was empty at
      // enqueue → skip, never push a blank doc (D7).
      const snapshotHtml = item.snapshotHtml ?? "";
      if (snapshotHtml.trim() === "") {
        this.log.log(`${ctx} terminal=SKIPPED reason=empty-source`);
        await this.finishItem(item, "SKIPPED", EMPTY_SKIP_REASON);
        return;
      }

      // (e) decrypted token pool for the destination (least-loaded pacing built in).
      step = "load-tokens";
      const pool = await this.credentials.getTokenPool(job.scopeId);

      // (f/g) create-or-override under the per-pair advisory lock; codaPageId is
      // committed here, BEFORE awaitMutation (C3). Returns the requestId to gate on.
      const chunks = chunkHtmlByBytes(snapshotHtml, this.maxHtmlBytes);
      step = item.override || item.codaPageId ? "override" : "create";
      const built = await this.createOrOverride(
        item,
        job.scopeId,
        scope.codaDocId,
        parentPageId,
        pool,
        chunks[0],
        ctx,
      );
      // A concurrent delete/cancel flipped the item to a terminal state between the
      // claim and the write (D7) — it's already SKIPPED, so abort quietly.
      if (!built) {
        this.log.log(`${ctx} aborted reason=item-terminated-mid-flight`);
        return;
      }

      // (H2) gate the create before descending; (H8) then stream the remaining
      // chunks in sequence, each paced + awaited. Skipped entirely on resume.
      if (built.requestId) {
        step = "await-mutation";
        await this.coda.awaitMutation(pool, built.requestId);
        this.log.debug(`${ctx} step=await-mutation req=${built.requestId} outcome=completed`);
        let chunkIdx = 1;
        for (const chunk of chunks.slice(1)) {
          if (this.stopped) return;
          step = `append-chunk-${chunkIdx}`;
          const r = await this.coda.appendPageContent(
            pool,
            scope.codaDocId,
            built.codaPageId,
            chunk,
          );
          await this.coda.awaitMutation(pool, r.requestId);
          this.log.debug(`${ctx} step=append-chunk-${chunkIdx} req=${r.requestId} bytes=${Buffer.byteLength(chunk, "utf8")}`);
          chunkIdx++;
        }
      }

      // (H2 materialization) A newly-created page is NOT immediately queryable, nor
      // usable as a parentPageId — Coda materializes it with a size-correlated delay
      // (tens of seconds) AFTER the create mutation reports done. Poll getPage until
      // it returns 200 before marking the item SUCCEEDED, so a child (gated on parent
      // SUCCEEDED) can safely use this codaPageId as its parentPageId. Also yields the
      // real per-page browserLink for the mapping. Throws (retryable transient) if it
      // never materializes. On the override path the page already exists → returns fast.
      step = "materialize";
      const url = await this.awaitMaterialization(
        pool,
        scope.codaDocId,
        built.codaPageId,
        ctx,
      );

      // (g) upsert the mapping (latest-wins) under the advisory lock, and (h/D1/D2)
      // record the enqueue-time head seq (== what we pushed) + mark the item SUCCEEDED.
      step = "map";
      const migratedSeq = item.enqueuedSeq ?? 0;
      const mapped = await this.upsertMapping(item.sourceDocId, job.scopeId, {
        codaPageId: built.codaPageId,
        codaPageUrl: url,
        migratedSeq,
      });
      // The source doc was deleted mid-flight → its mapping FK is gone (D7). The delete
      // hook already SKIPPED this item, so treat it as a quiet abort, not an error.
      if (!mapped) {
        this.log.log(`${ctx} aborted reason=source-deleted-during-map`);
        return;
      }
      this.log.log(
        `${ctx} terminal=SUCCEEDED page=${built.codaPageId} url=${url} migratedSeq=${migratedSeq}`,
      );
      await this.finishItem(item, "SUCCEEDED", null, {
        codaPageId: built.codaPageId,
        migratedSeq,
      });
    } catch (e) {
      await this.handleItemError(item, e, step);
    } finally {
      await this.maybeFinalizeJob(item.jobId).catch((e) =>
        this.log.error(`finalize job ${item.jobId} failed`, e as Error),
      );
    }
  }

  // Resolve the parent Coda page id from the DB (survives restart). Null planned
  // parent → the scope root (page-root) or none (whole-doc). Else → the sibling
  // item's persisted codaPageId, guaranteed set by the readiness gate.
  private async resolveCodaParent(
    item: ClaimedItem,
    codaRootPageId: string | null,
  ): Promise<string | undefined> {
    if (item.plannedParentDocId === null) {
      return codaRootPageId ?? undefined;
    }
    const parent = await this.prisma.migrationJobItem.findFirst({
      where: { jobId: item.jobId, sourceDocId: item.plannedParentDocId },
      select: { codaPageId: true },
    });
    if (!parent?.codaPageId) {
      // The readiness gate should prevent this; treat as retryable if it races.
      throw new Error("parent Coda page not resolved");
    }
    return parent.codaPageId;
  }

  // Create-vs-reuse for an item's Coda page, guarding idempotency (D6/C3).
  //   - Fresh item (no page yet) → createPage + persist the id BEFORE awaitMutation.
  //   - Override target OR a page a prior attempt created before crashing → reuse it,
  //     replacing content in place — never a second page, never a skipped write.
  // The reuse path AWAITS MATERIALIZATION before the in-place replace: a page created
  // just before a crash (C3 persisted the id) may not be queryable yet, and a blind
  // `PUT /pages/:id` would then hit a PERMANENT 404 ("could not find a page") and
  // falsely FAIL the item — even though the page materializes seconds later. Polling
  // first (same poll the create path uses) tells "not yet materialized" (self-heals)
  // apart from "genuinely gone", so the transient window can never permanent-fail.
  private async createOrOverride(
    item: ClaimedItem,
    scopeId: string,
    codaDocId: string,
    parentPageId: string | undefined,
    pool: string[],
    firstChunk: string,
    ctx: string,
  ): Promise<BuiltPage | null> {
    // Decide the page to reuse (if any) under the advisory lock. This tx does no
    // network I/O (just a read + override-target adoption), so it can't blow the tx
    // timeout the way an in-lock materialization poll (up to CODA_MATERIALIZE_TIMEOUT_MS)
    // would; the poll + write happen outside the tx below (never inside one).
    const reusePageId = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(item.sourceDocId, scopeId)}))`;
        // An "Update existing" item targets a specific pre-existing page (H3).
        if (item.override && item.targetCodaPageId) return item.targetCodaPageId;
        // Else re-read inside the lock so a crash-resume reuses the persisted page (C3).
        const fresh = await tx.migrationJobItem.findUnique({
          where: { id: item.id },
          select: { codaPageId: true },
        });
        // NOTE: deliberately NOT consulting MigrationMapping here — "Create new" must always
        // create (design §identity: mappings are opt-in via prefill/override only; D6 accepts
        // cross-job duplicates). A mapped page may also be long-deleted (410).
        return fresh?.codaPageId ?? null;
      },
      { timeout: CREATE_TX_TIMEOUT_MS },
    );

    // No page yet ⇒ a normal create.
    if (!reusePageId) {
      return this.createPageAndPersist(
        item,
        scopeId,
        codaDocId,
        parentPageId,
        pool,
        firstChunk,
        ctx,
      );
    }

    // Reuse path: await materialization BEFORE the replace so a not-yet-queryable
    // page (crash in the create→materialize window, item 58) is never mistaken for a
    // deleted one. Returns the page on materialization, or null past the poll budget.
    const materialized = await this.pollUntilMaterialized(
      pool,
      codaDocId,
      reusePageId,
      ctx,
    );
    if (materialized) {
      return this.replacePageAndPersist(
        item,
        scopeId,
        codaDocId,
        reusePageId,
        pool,
        firstChunk,
        ctx,
      );
    }

    // Never materialized within the budget ⇒ the id is unusable. Distinguish by intent:
    if (!item.override) {
      // A create-item just needs *a* page, and its id came from our OWN prior
      // createPage (not a user target). The old page is dead/never-queryable → recreate
      // a fresh one, overwriting the dead id. The advisory lock + single-create-per-
      // attempt keep this from duplicating a LIVE page (idempotency preserved).
      this.log.warn(
        `${ctx} step=resume-recreate resumePage=${reusePageId} never materialized within ${this.materializeTimeoutMs}ms → recreating`,
      );
      return this.createPageAndPersist(
        item,
        scopeId,
        codaDocId,
        parentPageId,
        pool,
        firstChunk,
        ctx,
      );
    }
    // A user OVERRIDE target that never materializes is genuinely gone (deleted
    // upstream) → PERMANENT fail with a clear reason; never silently recreate a user's
    // target under a new id. Shaped as a Coda 404 so isTransientError classifies it
    // permanent (fails at the attempt cap), with a descriptive lastError.
    throw new HttpException(
      {
        error: "coda api error",
        status: 404,
        body: `override target page ${reusePageId} not found (did not materialize within ${this.materializeTimeoutMs}ms)`,
      },
      502,
    );
  }

  // Create a fresh Coda page, then persist its id. CRITICAL (C3/C4): the Coda write
  // runs OUTSIDE any Prisma transaction — a paced write with retries inside a tx can
  // expire the tx AFTER Coda created the page but BEFORE the id commits, rolling back
  // the id so the retry duplicates the page. The id is persisted immediately after the
  // 202, still BEFORE the caller awaits the mutation. Aborts (returns null) if the item
  // was concurrently terminated (delete/cancel) — see stillLeased / persistCodaPageId.
  private async createPageAndPersist(
    item: ClaimedItem,
    scopeId: string,
    codaDocId: string,
    parentPageId: string | undefined,
    pool: string[],
    firstChunk: string,
    ctx: string,
  ): Promise<BuiltPage | null> {
    if (!(await this.stillLeased(item, ctx, "create"))) return null;
    const r = await this.coda.createPage(pool, codaDocId, {
      name: item.title,
      parentPageId,
      html: firstChunk,
    });
    if (!(await this.persistCodaPageId(item, scopeId, r.id, ctx))) return null;
    this.log.log(
      `${ctx} step=create page=${r.id} req=${r.requestId} parent=${parentPageId ?? "root"} bytes=${Buffer.byteLength(firstChunk, "utf8")}`,
    );
    return { codaPageId: r.id, requestId: r.requestId };
  }

  // Wholesale-replace a known page's content in place and (re)persist its id. Like
  // createPageAndPersist, the Coda write runs OUTSIDE any tx (C3/C4) and the id is
  // persisted before the caller awaits the mutation. Aborts (null) on concurrent
  // termination.
  private async replacePageAndPersist(
    item: ClaimedItem,
    scopeId: string,
    codaDocId: string,
    pageId: string,
    pool: string[],
    firstChunk: string,
    ctx: string,
  ): Promise<BuiltPage | null> {
    if (!(await this.stillLeased(item, ctx, "override"))) return null;
    const r = await this.coda.replacePageContent(
      pool,
      codaDocId,
      pageId,
      firstChunk,
    );
    if (!(await this.persistCodaPageId(item, scopeId, pageId, ctx))) return null;
    this.log.log(
      `${ctx} step=override page=${pageId} req=${r.requestId} bytes=${Buffer.byteLength(firstChunk, "utf8")}`,
    );
    return { codaPageId: pageId, requestId: r.requestId };
  }

  // Re-read the item's status/lease immediately before a Coda create/replace (D7): if
  // it is no longer RUNNING under THIS worker's lease (e.g. a concurrent delete flipped
  // it to SKIPPED), don't write — it's already terminal. Returns whether we still hold it.
  private async stillLeased(
    item: ClaimedItem,
    ctx: string,
    step: string,
  ): Promise<boolean> {
    const current = await this.prisma.migrationJobItem.findUnique({
      where: { id: item.id },
      select: { status: true, leasedBy: true },
    });
    const held = current?.status === "RUNNING" && current.leasedBy === this.workerId;
    if (!held) {
      this.log.log(
        `${ctx} step=${step} aborted reason=item-no-longer-leased status=${current?.status ?? "gone"}`,
      );
    }
    return held;
  }

  // Persist a just-created/reused Coda page id under the advisory lock, in a SHORT tx
  // (no network I/O). Guarded on the item still being RUNNING under our lease (D7): if
  // it matched 0 rows the item was concurrently terminated, so the page we just created
  // may be orphaned (logged) — the caller aborts. Committed BEFORE awaitMutation (C3).
  private async persistCodaPageId(
    item: ClaimedItem,
    scopeId: string,
    codaPageId: string,
    ctx: string,
  ): Promise<boolean> {
    const matched = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(item.sourceDocId, scopeId)}))`;
        const res = await tx.migrationJobItem.updateMany({
          where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
          data: { codaPageId },
        });
        return res.count > 0;
      },
      { timeout: CREATE_TX_TIMEOUT_MS },
    );
    if (!matched) {
      this.log.warn(
        `${ctx} persist-codaPageId matched 0 rows (item no longer leased) — coda page ${codaPageId} may be orphaned`,
      );
    }
    return matched;
  }

  // Upsert the latest-wins (sourceDocId, scopeId) mapping under the same advisory
  // lock so concurrent jobs never produce a torn/untracked mapping (D6). Returns false
  // if the source doc was deleted mid-flight (FK violation, D7): the caller treats that
  // as a quiet abort (the item is already SKIPPED), never a handleItemError failure.
  private async upsertMapping(
    sourceDocId: string,
    scopeId: string,
    data: { codaPageId: string; codaPageUrl: string; migratedSeq: number },
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(sourceDocId, scopeId)}))`;
        const now = new Date();
        await tx.migrationMapping.upsert({
          where: { sourceDocId_scopeId: { sourceDocId, scopeId } },
          create: { sourceDocId, scopeId, ...data, lastMigratedAt: now },
          update: { ...data, lastMigratedAt: now },
        });
      });
      return true;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        this.log.warn(
          `mapping upsert for source ${sourceDocId} hit an FK violation (source doc deleted mid-flight) — skipping`,
        );
        return false;
      }
      throw e;
    }
  }

  // Wait for a page to materialize, and return its real browser URL for the mapping.
  // Coda's create is async: even after the create mutation reports done, the page is
  // NOT queryable and cannot be used as a parentPageId for a size-correlated window
  // (tens of seconds). Poll getPage (via getPageOrNull, 404 → not ready) until it
  // returns 200, backing off from materializePollMs up to a 5s cap. On success the
  // browserLink is a real per-page URL — NEVER "". If the page never materializes
  // within the budget, THROW: the item stays retryable and is not falsely marked
  // done with an unusable page (which would orphan its children). The override path
  // targets a pre-existing page, so the first poll returns 200 with no wait.
  private async awaitMaterialization(
    pool: string[],
    codaDocId: string,
    pageId: string,
    ctx: string,
  ): Promise<string> {
    const page = await this.pollUntilMaterialized(pool, codaDocId, pageId, ctx);
    if (page) return page.browserLink ?? "";
    // TRANSIENT (not a plain Error): "not queryable yet" is self-healing, so retry
    // without burning an attempt. A truly-gone page fails later via the permanent 404
    // its in-place replace returns (never a false created-FAILED).
    throw new HttpException(
      {
        error: NOT_MATERIALIZED_ERROR,
        pageId,
        body: `did not materialize within ${this.materializeTimeoutMs}ms`,
      },
      504,
    );
  }

  // Poll getPageOrNull until the page is queryable (200) or the materialize budget is
  // exhausted, backing off from materializePollMs to a 5s cap. Returns the CodaPage on
  // materialization, or null if it never materialized in time. Shared by the create-
  // path materialization gate (awaitMaterialization) and the resume-path pre-replace
  // check (createOrOverride), so both treat "404 = not ready yet" identically.
  private async pollUntilMaterialized(
    pool: string[],
    codaDocId: string,
    pageId: string,
    ctx: string,
  ): Promise<CodaPage | null> {
    let pollMs = this.materializePollMs;
    let poll = 0;
    const deadline = Date.now() + this.materializeTimeoutMs;
    for (;;) {
      poll++;
      const page = await this.coda.getPageOrNull(pool, codaDocId, pageId);
      if (page) {
        this.log.debug(
          `${ctx} step=materialize poll=${poll} outcome=ready page=${pageId} url=${page.browserLink ?? ""}`,
        );
        return page;
      }
      this.log.debug(
        `${ctx} step=materialize poll=${poll} outcome=not-ready page=${pageId}`,
      );
      if (Date.now() + pollMs >= deadline) return null;
      await sleep(pollMs);
      pollMs = Math.min(pollMs * 1.5, 5_000);
    }
  }

  // Terminal item transition, guarded on the item still being RUNNING under THIS
  // worker's lease so a lease steal / concurrent cancel never double-counts, and
  // the job counter is bumped by the rows actually transitioned.
  private async finishItem(
    item: ClaimedItem,
    status: "SUCCEEDED" | "SKIPPED",
    lastError: string | null,
    extra?: { codaPageId?: string; migratedSeq?: number },
  ): Promise<void> {
    const counter = status === "SUCCEEDED" ? "succeededItems" : "skippedItems";
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.migrationJobItem.updateMany({
        where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
        data: {
          status,
          lastError,
          leasedBy: null,
          leasedUntil: null,
          ...(extra?.codaPageId ? { codaPageId: extra.codaPageId } : {}),
          ...(extra?.migratedSeq != null ? { migratedSeq: extra.migratedSeq } : {}),
        },
      });
      if (res.count > 0) {
        await tx.migrationJob.update({
          where: { id: item.jobId },
          data: { [counter]: { increment: res.count } },
        });
      }
    });
  }

  // On error: bump attempts; at the class's cap → FAILED (+lastError, +failedItems),
  // else release the lease back to PENDING for a later retry (CodaClient retries 429s).
  //
  // TRANSIENT infra blips — rtc-server unreachable mid-restart, Coda unreachable /
  // 429 / 5xx / mutation-timeout — self-heal, so they release the lease back to PENDING
  // after a GROWING backoff (base × 2^(attempts-1), capped) and get a GENEROUS budget
  // (maxTransientAttempts) that comfortably outlasts a routine ~10-30s dependency blip.
  // They STILL fail at that cap, so a permanently-transient condition ('coda mutation
  // timed out' on an oversized doc) can't retry forever keeping the job RUNNING.
  // PERMANENT errors (Coda 4xx like Invalid parentPageId, bad content, permission-lost)
  // get a SMALL budget (maxAttempts) and NO backoff — retrying won't change the outcome.
  private async handleItemError(
    item: ClaimedItem,
    e: unknown,
    step = "unknown",
  ): Promise<void> {
    const msg = describeError(e).slice(0, 1000);
    const ctx = `[job=${item.jobId} item=${item.id} src=${item.sourceDocId} seq=${item.seq}]`;
    const transient = isTransientError(e);
    const cls = transient ? "TRANSIENT" : "PERMANENT";
    // Transient and permanent errors have SEPARATE budgets: each error kind bumps and
    // checks ONLY its own counter, so a burned transient budget never fails an item on
    // its first permanent error (and vice versa).
    const attempts = transient ? item.attempts : item.attempts + 1;
    const transientAttempts = transient
      ? item.transientAttempts + 1
      : item.transientAttempts;
    const cap = transient ? this.maxTransientAttempts : this.maxAttempts;
    const count = transient ? transientAttempts : attempts;

    if (count >= cap) {
      this.log.warn(
        `${ctx} step=${step} class=${cls} terminal=FAILED attempts=${attempts} transientAttempts=${transientAttempts} cap=${cap} page=${item.codaPageId ?? "-"} error="${msg}"`,
      );
      await this.failItem(item, attempts, transientAttempts, msg);
      return;
    }

    // Below the cap: release the lease back to PENDING for a later retry. Transient
    // errors back off (growing per transient attempt) so a downed dependency isn't hot-looped.
    if (transient) {
      const backoff = Math.min(
        this.transientBackoffMs * 2 ** (transientAttempts - 1),
        60_000,
      );
      await sleep(backoff);
    }
    this.log.warn(
      `${ctx} step=${step} class=${cls} action=release-for-retry attempts=${attempts} transientAttempts=${transientAttempts} cap=${cap} error="${msg}"`,
    );
    await this.prisma.migrationJobItem
      .updateMany({
        where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
        data: {
          status: "PENDING",
          attempts,
          transientAttempts,
          lastError: msg,
          leasedBy: null,
          leasedUntil: null,
        },
      })
      .catch((err) => this.log.error("releasing item for retry failed", err));
  }

  // Terminal FAILED transition (+lastError, +failedItems), guarded on the item still
  // being RUNNING under our lease so a steal/cancel can't double-count.
  private async failItem(
    item: ClaimedItem,
    attempts: number,
    transientAttempts: number,
    msg: string,
  ): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        const res = await tx.migrationJobItem.updateMany({
          where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
          data: {
            status: "FAILED",
            attempts,
            transientAttempts,
            lastError: msg,
            leasedBy: null,
            leasedUntil: null,
          },
        });
        if (res.count > 0) {
          await tx.migrationJob.update({
            where: { id: item.jobId },
            data: { failedItems: { increment: res.count } },
          });
        }
      })
      .catch((err) => this.log.error("recording FAILED item failed", err));
  }

  // Flip QUEUED → RUNNING and stamp startedAt on the first item pickup (idempotent).
  private async markJobStarted(jobId: string): Promise<void> {
    await this.prisma.migrationJob.updateMany({
      where: { id: jobId, startedAt: null },
      data: { startedAt: new Date() },
    });
    await this.prisma.migrationJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
  }

  // When a job has no PENDING/RUNNING items left, finalize it so job status ==
  // reality. A SKIP is "clean" ONLY if the source was genuinely empty (EMPTY_SKIP_
  // REASON) — a no-op that doesn't count against success. EVERY other skip (a
  // parent-failure orphan, an unreadable/deleted source, a removed destination)
  // means a SELECTED doc could not be migrated and is "tainting":
  //   SUCCEEDED  ⟺ zero FAILED and zero tainting skips (all done, or clean no-ops);
  //   PARTIAL    ⟺ something succeeded but something else didn't (mixed);
  //   FAILED     ⟺ nothing succeeded and something failed/could-not-migrate.
  // So the job is NEVER green while a real selected doc didn't land, and NEVER
  // FAILED/PARTIAL while everything actually completed. Guarded on QUEUED/RUNNING so
  // a CANCELED (or already-finalized) job is never clobbered. Public so DocumentsService
  // can finalize a job stranded by a delete that skipped its last claimable item (D7).
  async maybeFinalizeJob(jobId: string): Promise<void> {
    const inFlight = await this.prisma.migrationJobItem.count({
      where: { jobId, status: { in: [...PENDING_OR_RUNNING] } },
    });
    if (inFlight > 0) return;

    const [failed, succeeded, skipped, cleanEmpty] = await Promise.all([
      this.prisma.migrationJobItem.count({ where: { jobId, status: "FAILED" } }),
      this.prisma.migrationJobItem.count({
        where: { jobId, status: "SUCCEEDED" },
      }),
      this.prisma.migrationJobItem.count({ where: { jobId, status: "SKIPPED" } }),
      this.prisma.migrationJobItem.count({
        where: { jobId, status: "SKIPPED", lastError: EMPTY_SKIP_REASON },
      }),
    ]);
    // A selected doc that could not be migrated (orphan, unreadable, dest-removed).
    const tainting = skipped - cleanEmpty;
    const status =
      failed === 0 && tainting === 0
        ? "SUCCEEDED"
        : succeeded > 0
          ? "PARTIAL"
          : "FAILED";
    const res = await this.prisma.migrationJob.updateMany({
      where: { id: jobId, status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
      data: { status, finishedAt: new Date() },
    });
    if (res.count > 0) {
      this.log.log(
        `[job=${jobId}] finalized=${status} succeeded=${succeeded} failed=${failed} skipped=${skipped}(empty=${cleanEmpty},tainting=${tainting})`,
      );
    }
  }
}

// Stable string key for the per-pair pg advisory lock (D6).
function lockKey(sourceDocId: string, scopeId: string): string {
  return `migration:${sourceDocId}:${scopeId}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

// A useful failure reason for lastError. A CodaClient HttpException carries a
// structured payload (status + truncated upstream body); surface that as e.g.
// "coda api error 400: Invalid parentPageId…" instead of the generic
// HttpException.message ("Http Exception"), which hides the real cause.
function describeError(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (r && typeof r === "object") {
      const { error, status, body } = r as {
        error?: string;
        status?: number;
        body?: string;
      };
      const head = status ? `${error ?? "error"} ${status}` : (error ?? "error");
      return body ? `${head}: ${body}` : head;
    }
    return String(r);
  }
  return e instanceof Error ? e.message : String(e);
}

// Classify a thrown error as a TRANSIENT infra blip (retry without consuming the
// attempt budget) vs. a PERMANENT failure (consume attempts, FAIL at the cap).
// Transient = a dependency is unreachable/overloaded and should self-heal:
//   - rtc-server / Coda "unreachable" (network failure, e.g. a mid-restart backend),
//   - Coda "rate limited" (429 exhausted) or "mutation timed out" (async took too long),
//   - Coda upstream 5xx (surfaced in the wrapper HttpException payload's `status`).
// Everything else — notably Coda 4xx like "400 Invalid parentPageId" — is permanent.
export function isTransientError(e: unknown): boolean {
  if (!(e instanceof HttpException)) return false;
  const r = e.getResponse();
  const payload =
    r && typeof r === "object" ? (r as { error?: string; status?: number }) : {};
  const error = payload.error ?? "";
  if (/unreachable/i.test(error)) return true;
  if (
    error === "coda rate limited" ||
    error === "coda mutation timed out" ||
    error === NOT_MATERIALIZED_ERROR
  ) {
    return true;
  }
  if (typeof payload.status === "number" && payload.status >= 500) return true;
  return false;
}

// HTML void/self-closing elements that never open a nesting level.
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Split constrained HTML into chunks each within maxBytes (H8), breaking only on
// top-level element boundaries so every chunk is self-contained. A single element
// larger than the budget is emitted alone (best-effort — Coda may still reject it).
export function chunkHtmlByBytes(html: string, maxBytes: number): string[] {
  if (Buffer.byteLength(html, "utf8") <= maxBytes) return [html];
  return packByBytes(splitTopLevelElements(html), maxBytes);
}

function splitTopLevelElements(html: string): string[] {
  const parts: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const isClose = m[1] === "/";
    const tag = m[2].toLowerCase();
    const selfClose = m[3] === "/" || VOID_ELEMENTS.has(tag);
    if (isClose) {
      if (depth > 0) depth--;
      if (depth === 0) {
        parts.push(html.slice(start, tagRe.lastIndex));
        start = tagRe.lastIndex;
      }
    } else if (selfClose) {
      if (depth === 0) {
        parts.push(html.slice(start, tagRe.lastIndex));
        start = tagRe.lastIndex;
      }
    } else {
      depth++;
    }
  }
  const tail = html.slice(start);
  if (tail.trim()) parts.push(tail);
  return parts.length > 0 ? parts : [html];
}

function packByBytes(parts: string[], maxBytes: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (cur && Buffer.byteLength(cur + part, "utf8") > maxBytes) {
      chunks.push(cur);
      cur = "";
    }
    cur += part;
  }
  if (cur) chunks.push(cur);
  return chunks.length > 0 ? chunks : [""];
}
