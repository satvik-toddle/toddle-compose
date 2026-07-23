import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@app/database";
import type { Env } from "../config/env";
import type { AuthUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { CodaClient } from "../coda/coda.client";
import { sanitizeCodaImportHtml } from "../coda/coda-import-sanitizer";
import { RtcContentClient } from "../rtc/rtc-content.client";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import { NON_TERMINAL_JOB_STATUSES } from "../migration/job-status";
import { TokenCipher } from "../migration/token-cipher";
import { CodaImportCredentialsService } from "./coda-import-credentials.service";

// Phase 7 — the STANDALONE "Import from Coda" worker. It runs in its OWN process
// (worker-main.ts), NOT the API and NOT rtc-server: the backend only enqueues a
// QUEUED CodaImportJob and POSTs /run to wake this worker, which then plans and
// executes the whole run to completion. Modeled on MigrationWorkerService (the
// reverse direction): the same durable engine — atomic lease-claim with FOR UPDATE
// SKIP LOCKED, resume-from-DB on boot, transient/permanent retry split, parent-
// gating, maybeFinalizeJob — but reads a Coda doc subtree into a fresh toddle-compose
// workspace instead of pushing docs out to Coda. rtc-server is used ONLY as the
// content-write engine (RtcContentClient.replaceHtml). All progress is in Postgres,
// so a crash/restart resumes exactly where it left off:
//   - PLAN creates items idempotently (skipDuplicates on @@unique([jobId, codaPageId]))
//     and flips planningComplete only after the last item, so a re-ping never double-
//     creates and a mid-plan crash re-plans (whole-doc imports plan incrementally, one
//     createMany per listPages batch; page-root plans the whole subtree at once);
//   - createdDocId is persisted the instant the toddle-compose doc is created, BEFORE
//     the content write, so a crash mid-write never re-creates the doc on resume;
//   - claim is an atomic conditional UPDATE with FOR UPDATE SKIP LOCKED → never double-
//     processes, and reclaims RUNNING items whose lease expired.

// Quoted SQL literal list ('QUEUED', 'RUNNING') spliced into the raw status IN (...)
// clauses. The values are compile-time constants, so the raw splice is injection-safe.
const LIVE_JOB_STATUS_SQL = Prisma.raw(
  NON_TERMINAL_JOB_STATUSES.map((s) => `'${s}'`).join(", "),
);

// A ready item, claimed by the atomic UPDATE (camelCase-aliased in RETURNING).
interface ClaimedItem {
  id: string;
  jobId: string;
  codaPageId: string;
  codaPageName: string;
  // Source Coda page URL (browserLink) → the reverse Copy-to-Coda mapping's prefill URL.
  codaPageUrl: string | null;
  // Parent Coda page id (null = top-level, imported directly under the new workspace).
  plannedParentCodaPageId: string | null;
  // The toddle-compose doc created for this page; set → resume reuses it (idempotency).
  createdDocId: string | null;
  // PERMANENT-error retry count (checked against maxAttempts).
  attempts: number;
  // TRANSIENT-error retry count (separate budget so burned transient retries never
  // starve the permanent-error retries).
  transientAttempts: number;
  seq: number;
}

// The job fields the reverse Copy-to-Coda linkage reads (a structural subset of the
// loaded CodaImportJob; extra fields on the passed object are ignored).
interface ImportJob {
  targetWorkspaceId: string | null;
  codaDocId: string;
  codaRootPageId: string | null;
  codaDocUrl: string;
  credentialId: string | null;
  createdById: string;
}

// A page row prepared during PLAN, before the depth-first seq is assigned.
interface PlannedItem {
  codaPageId: string;
  codaPageName: string;
  codaPageUrl: string | null;
  plannedParentCodaPageId: string | null;
}

const PENDING_OR_RUNNING = ["PENDING", "RUNNING"] as const;
// lastError stamped on a descendant cascade-skipped because its parent item ended
// terminally (FAILED/SKIPPED) and thus can never be placed. MUST match the literal in
// skipOrphansOfTerminalParents' SQL.
export const PARENT_SKIP_REASON = "parent page did not import";
// A short tx around the createMany PLAN / guarded createdDocId persist; no network I/O
// runs inside these (the Coda listing/export happen outside any tx), so a modest bump
// over Prisma's 5s interactive default is plenty even for a large page tree.
const WRITE_TX_TIMEOUT_MS = 30_000;

@Injectable()
export class CodaImportWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger("CodaImportWorker");
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
  // Base backoff before re-releasing a transient-failed item to PENDING; grows
  // exponentially per attempt (capped). Mutable so tests can zero it out.
  private transientBackoffMs = 3_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly documents: DocumentsService,
    private readonly coda: CodaClient,
    private readonly rtcContent: RtcContentClient,
    private readonly rtcInternal: RtcInternalClient,
    private readonly credentials: CodaImportCredentialsService,
    // Encrypts the per-scope Coda token for the reverse Copy-to-Coda linkage.
    private readonly cipher: TokenCipher,
  ) {
    this.leaseTtlMs = this.config.get("IMPORT_LEASE_TTL_MS", { infer: true });
    this.batchSize = this.config.get("IMPORT_BATCH_SIZE", { infer: true });
    this.maxAttempts = this.config.get("IMPORT_MAX_ITEM_ATTEMPTS", { infer: true });
    this.maxTransientAttempts = this.config.get("IMPORT_MAX_TRANSIENT_ATTEMPTS", {
      infer: true,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.interval = this.config.get("IMPORT_WORKER_INTERVAL_MS", { infer: true });

    // Boot-recovery is inherent in the claim (expired-lease reclaim + QUEUED/RUNNING
    // re-drive + planningComplete-guarded re-plan); just log a one-line summary of what
    // will be reclaimed. A read here must never abort boot.
    try {
      const reclaimable = await this.prisma.codaImportJobItem.count({
        where: { status: "RUNNING", leasedUntil: { lt: new Date() } },
      });
      if (reclaimable > 0) {
        this.log.warn(
          `boot recovery: ${reclaimable} RUNNING import item(s) with an expired lease will be reclaimed`,
        );
      }
    } catch (e) {
      this.log.error("boot-recovery count failed (continuing)", e as Error);
    }
    if (this.stopped) return;

    if (this.interval <= 0) {
      // Ping-only mode: no safety timer, but /run still drives the same tick loop.
      this.log.log(
        `import worker ping-only (IMPORT_WORKER_INTERVAL_MS<=0) worker=${this.workerId}`,
      );
      // Still sweep once at boot so a job enqueued while the worker was down is picked up.
      this.wake();
      return;
    }

    this.armed = true;
    this.log.log(
      `import worker armed: interval=${this.interval}ms worker=${this.workerId}`,
    );
    this.schedule(this.interval);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.armed) this.log.log("import worker stopped");
  }

  // The /run ping trigger: kick a tick immediately (the ticking guard collapses a
  // burst of pings into a single in-flight pass). Fire-and-forget — the controller
  // returns 202 without waiting for the run to finish.
  wake(): void {
    void this.tick().catch((e) => this.log.error("ping-triggered tick failed", e));
  }

  // One self-re-arming timer: each pass awaits before re-arming, so passes never
  // overlap. unref'd so a pending timer never keeps the process alive on shutdown.
  private schedule(delay: number): void {
    this.timer = setTimeout(async () => {
      await this.tick().catch((e) => this.log.error("import tick failed", e));
      if (!this.stopped) this.schedule(this.interval);
    }, delay);
    this.timer.unref?.();
  }

  // Plan any unplanned job, then claim and process ready items until none remain.
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (;;) {
        if (this.stopped) return;
        // Turn freshly-enqueued QUEUED jobs into item rows (idempotent; a no-op once
        // planned). Kept inside the loop so a child batch and a just-planned job in the
        // same tick both drain without waiting for the next timer/ping.
        await this.planUnplannedJobs();

        const items = await this.claimBatch();
        if (items.length === 0) {
          // Nothing claimable: a PENDING subtree may be permanently blocked on a parent
          // that ended terminally (can never be placed) — cascade-skip it so its job
          // finalizes instead of deadlocking. Then finalize every live job with no
          // remaining in-flight items (covers a 0-page doc and the just-cleared blocker).
          await this.skipOrphansOfTerminalParents();
          const live = await this.prisma.codaImportJob.findMany({
            where: { status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
            select: { id: true },
          });
          for (const { id } of live) {
            if (this.stopped) return;
            await this.maybeFinalizeJob(id).catch((e) =>
              this.log.error(`finalize import job ${id} failed`, e as Error),
            );
          }
          return;
        }
        // Process the claimed batch CONCURRENTLY so independent pages overlap their
        // Coda-export polls + rtc HTML→Lexical hydration. Safe: the CodaRateLimiter
        // serializes real Coda reads per token, the claim's parent gate keeps a child
        // out of the same batch as a not-yet-created parent, and processItem swallows
        // its own errors (so Promise.all never rejects).
        if (this.stopped) return;
        await Promise.all(items.map((item) => this.processItem(item)));
      }
    } finally {
      this.ticking = false;
    }
  }

  // Best-effort live activity line on the job row. updateMany so it never throws if the
  // row is gone; non-critical, so a write failure only logs (never fails the run).
  private async setProgress(jobId: string, message: string | null): Promise<void> {
    await this.prisma.codaImportJob
      .updateMany({ where: { id: jobId }, data: { progressMessage: message } })
      .catch((e) => this.log.error(`setProgress for job ${jobId} failed`, e as Error));
  }

  // Append a durable MILESTONE to the job's activity timeline (a separate row, so the
  // batch=4 concurrent worker appends race-free). Best-effort: swallow its own error so
  // a logging failure never fails the run. Milestones only — never per-item events.
  private async logEvent(jobId: string, message: string): Promise<void> {
    await this.prisma.codaImportJobEvent
      .create({ data: { jobId, message } })
      .catch((e) => this.log.error(`logEvent for job ${jobId} failed`, e as Error));
  }

  // --- Planning: Coda page tree → CodaImportJobItem rows ---------------------
  // Turn each not-yet-fully-planned live job into item rows. A job is "planned" once
  // planningComplete is set — NOT once startedAt is: a whole-doc import creates items
  // incrementally per listPages batch (rows appear while listing is still in flight),
  // so planningComplete (set only after the LAST batch) is the exact "no more items
  // will appear" guard that gates finalize/orphan-skip and survives a mid-plan crash.
  private async planUnplannedJobs(): Promise<void> {
    const jobs = await this.prisma.codaImportJob.findMany({
      where: {
        status: { in: [...NON_TERMINAL_JOB_STATUSES] },
        planningComplete: false,
      },
      select: {
        id: true,
        codaDocId: true,
        codaRootPageId: true,
        credentialId: true,
      },
    });
    for (const job of jobs) {
      if (this.stopped) return;
      await this.planJob(
        job.id,
        job.codaDocId,
        job.codaRootPageId,
        job.credentialId,
      ).catch((e) =>
        this.log.error(`planning import job ${job.id} failed`, e as Error),
      );
    }
  }

  // The token pool for a job: the single pinned credential when set, else the whole
  // pool (legacy jobs enqueued before per-job credential selection). Throws NotFound
  // if a pinned credential was deleted — handled as a permanent per-item error.
  private async poolForJob(credentialId: string | null): Promise<string[]> {
    if (credentialId) return [await this.credentials.getToken(credentialId)];
    return this.credentials.getTokenPool();
  }

  // List the source doc's pages (network — OUTSIDE any tx) and turn them into item
  // rows. Two shapes, both idempotent on the @@unique([jobId, codaPageId]) so a re-plan
  // after a mid-listing crash re-adds only the pages missing so far:
  //   - WHOLE-DOC (codaRootPageId null): create items PER listPages batch as pages
  //     arrive, so the detail table populates progressively and top-level items can be
  //     claimed while listing is still in flight;
  //   - PAGE-ROOT: needs the FULL tree to scope the subtree, so it lists everything,
  //     orders it depth-first, and creates the items in one shot.
  // Either way planningComplete flips true only after the last item is created — the
  // guard that lets finalize/orphan-skip run (they must NOT while more items may appear).
  private async planJob(
    jobId: string,
    codaDocId: string,
    codaRootPageId: string | null,
    credentialId: string | null,
  ): Promise<void> {
    const pool = await this.poolForJob(credentialId);
    if (pool.length === 0) {
      // No token → can't list pages. Leave the job unplanned (planningComplete false)
      // so a later tick retries once a credential is configured; log so it's visible.
      this.log.warn(
        `[import job=${jobId}] no Coda import token configured — deferring plan`,
      );
      return;
    }

    // Flip QUEUED → RUNNING up front so the whole (potentially long) listing/planning
    // phase reads as active in the UI, not stuck QUEUED. Guarded on status=QUEUED
    // (idempotent; never clobbers a CANCELED job).
    await this.prisma.codaImportJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
    await this.setProgress(jobId, "Fetching pages from Coda…");
    await this.logEvent(jobId, "Fetching pages from Coda…");

    if (codaRootPageId === null) {
      await this.planWholeDocIncrementally(jobId, codaDocId, pool);
    } else {
      await this.planPageRootAtOnce(jobId, codaDocId, codaRootPageId, pool);
    }
  }

  // WHOLE-DOC plan: create items per listPages batch. Each page keeps its REAL Coda
  // parent id (null only when it genuinely has none); a child listed before its parent
  // is fine — the claim gates it on the parent ITEM existing + a created doc, so it just
  // waits. skipDuplicates makes each batch idempotent, so a re-plan after a crash re-adds
  // only the missing pages. Stops between batches if the job was canceled.
  private async planWholeDocIncrementally(
    jobId: string,
    codaDocId: string,
    pool: string[],
  ): Promise<void> {
    let seq = 0;
    let created = 0;
    let lastProgressAt = 0;
    let canceled = false;
    await this.coda.listPages(pool, codaDocId, undefined, async (batch, fetched) => {
      if (canceled) return;
      const batchItems = batch.map((p) => ({
        jobId,
        codaPageId: p.id,
        codaPageName: p.name ?? "Untitled",
        codaPageUrl: p.browserLink ?? null,
        plannedParentCodaPageId: p.parent?.id ?? null,
        seq: seq++,
      }));
      if (batchItems.length > 0) {
        // Idempotent on @@unique([jobId, codaPageId]); count reflects only rows actually
        // inserted, so a re-plan never double-counts totalItems.
        const res = await this.prisma.codaImportJobItem.createMany({
          data: batchItems,
          skipDuplicates: true,
        });
        created += res.count;
        if (res.count > 0) {
          await this.prisma.codaImportJob.update({
            where: { id: jobId },
            data: { totalItems: { increment: res.count } },
          });
        }
      }
      const now = Date.now();
      if (now - lastProgressAt >= 1_000) {
        lastProgressAt = now;
        await this.setProgress(jobId, `Fetching pages from Coda… (${fetched})`);
      }
      // One milestone per listPages batch (~4 for a 342-page doc) — not per page.
      if (batch.length > 0) await this.logEvent(jobId, `Fetched ${fetched} pages`);
      // Stop planning the moment the job is canceled — no point listing the rest.
      const job = await this.prisma.codaImportJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!job || job.status === "CANCELED") canceled = true;
    });

    if (canceled) {
      this.log.log(`[import job=${jobId}] planning stopped — job canceled`);
      return;
    }
    // All pages are now known: promote any page whose parent isn't itself an item
    // (a parent ref outside the doc's page set) to top-level, so a child can never
    // deadlock forever-PENDING on a parent item that will never exist.
    await this.orphanUnknownParents(jobId);
    // Milestone BEFORE completePlanning so "Found N… → Importing…" stay in order.
    await this.logEvent(jobId, `Found ${created} page(s) — creating documents`);
    await this.completePlanning(jobId);
    this.log.log(
      `[import job=${jobId}] planned ${created} page(s) from codaDoc=${codaDocId} root=whole-doc`,
    );
  }

  // PAGE-ROOT plan: the subtree needs the full tree, so list everything, order it
  // depth-first, and create the items in one shot. createMany uses skipDuplicates so a
  // re-plan after a crash (planningComplete still false) re-adds only missing pages.
  private async planPageRootAtOnce(
    jobId: string,
    codaDocId: string,
    codaRootPageId: string,
    pool: string[],
  ): Promise<void> {
    let lastProgressAt = 0;
    const pages = await this.coda.listPages(pool, codaDocId, (fetched) => {
      const now = Date.now();
      if (now - lastProgressAt < 1_000) return;
      lastProgressAt = now;
      void this.setProgress(jobId, `Fetching pages from Coda… (${fetched})`);
    });
    const planned = orderDepthFirst(pages, codaRootPageId);
    await this.setProgress(jobId, `Preparing ${planned.length} documents…`);

    await this.prisma.$transaction(
      async (tx) => {
        if (planned.length > 0) {
          const res = await tx.codaImportJobItem.createMany({
            data: planned.map((p, i) => ({
              jobId,
              codaPageId: p.codaPageId,
              codaPageName: p.codaPageName,
              codaPageUrl: p.codaPageUrl,
              plannedParentCodaPageId: p.plannedParentCodaPageId,
              seq: i,
            })),
            skipDuplicates: true,
          });
          if (res.count > 0) {
            await tx.codaImportJob.update({
              where: { id: jobId },
              data: { totalItems: { increment: res.count } },
            });
          }
        }
      },
      { timeout: WRITE_TX_TIMEOUT_MS },
    );
    // Milestone BEFORE completePlanning so "Planned N… → Importing…" stay in order.
    await this.logEvent(jobId, `Planned ${planned.length} document(s)`);
    await this.completePlanning(jobId);
    this.log.log(
      `[import job=${jobId}] planned ${planned.length} page(s) from codaDoc=${codaDocId} root=${codaRootPageId}`,
    );
  }

  // Null out any plannedParentCodaPageId that has no sibling item (a parent ref outside
  // the doc's page set) so the orphaned child becomes top-level rather than deadlocking
  // on a parent item that will never be created. Run once all items exist.
  private async orphanUnknownParents(jobId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE coda_import_job_items c
      SET planned_parent_coda_page_id = NULL, updated_at = now()
      WHERE c.job_id = ${jobId}
        AND c.planned_parent_coda_page_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM coda_import_job_items p
          WHERE p.job_id = c.job_id
            AND p.coda_page_id = c.planned_parent_coda_page_id
        )
    `;
  }

  // Close out planning: stamp startedAt if unset, mark planningComplete so finalize /
  // orphan-skip may run, and switch the activity line to the import phase. Guarded on
  // QUEUED/RUNNING so a concurrent cancel is never clobbered.
  private async completePlanning(jobId: string): Promise<void> {
    await this.prisma.codaImportJob.updateMany({
      where: {
        id: jobId,
        status: { in: [...NON_TERMINAL_JOB_STATUSES] },
        startedAt: null,
      },
      data: { startedAt: new Date() },
    });
    const res = await this.prisma.codaImportJob.updateMany({
      where: {
        id: jobId,
        status: { in: [...NON_TERMINAL_JOB_STATUSES] },
        planningComplete: false,
      },
      data: { planningComplete: true, progressMessage: "Importing documents…" },
    });
    // Guard on the false→true transition so a re-plan (or concurrent items) logs the
    // "Importing documents…" milestone exactly once per job.
    if (res.count > 0) await this.logEvent(jobId, "Importing documents…");
  }

  // --- The integrity core: atomic lease claim -------------------------------
  // A single conditional UPDATE flips a batch of READY items to RUNNING under this
  // worker's lease. READY = the job is live (QUEUED/RUNNING) AND the item is PENDING
  // (or RUNNING with an expired lease — crash reclaim) AND its parent is placed (no
  // planned parent, or the sibling item with that codaPageId already has createdDocId
  // set). Gating on the parent's createdDocId — persisted the instant the parent
  // toddle-compose doc is created — guarantees a valid parentId exists before a child
  // nests under it, and survives restart (state read from the DB, not memory). FOR
  // UPDATE ... SKIP LOCKED + the lease guarantee no item is ever taken twice.
  private async claimBatch(): Promise<ClaimedItem[]> {
    const leasedUntil = new Date(Date.now() + this.leaseTtlMs);
    return this.prisma.$queryRaw<ClaimedItem[]>`
      UPDATE coda_import_job_items i
      SET status = 'RUNNING',
          leased_by = ${this.workerId},
          leased_until = ${leasedUntil},
          updated_at = now()
      WHERE i.id IN (
        SELECT c.id
        FROM coda_import_job_items c
        JOIN coda_import_jobs j ON j.id = c.job_id
        WHERE j.status IN (${LIVE_JOB_STATUS_SQL})
          AND (
            c.status = 'PENDING'
            OR (c.status = 'RUNNING' AND c.leased_until IS NOT NULL AND c.leased_until < now())
          )
          AND (
            c.planned_parent_coda_page_id IS NULL
            OR EXISTS (
              SELECT 1 FROM coda_import_job_items p
              WHERE p.job_id = c.job_id
                AND p.coda_page_id = c.planned_parent_coda_page_id
                AND p.created_doc_id IS NOT NULL
            )
          )
        ORDER BY c.job_id, c.seq
        FOR UPDATE OF c SKIP LOCKED
        LIMIT ${this.batchSize}
      )
      RETURNING
        i.id,
        i.job_id AS "jobId",
        i.coda_page_id AS "codaPageId",
        i.coda_page_name AS "codaPageName",
        i.coda_page_url AS "codaPageUrl",
        i.planned_parent_coda_page_id AS "plannedParentCodaPageId",
        i.created_doc_id AS "createdDocId",
        i.attempts,
        i.transient_attempts AS "transientAttempts",
        i.seq
    `;
  }

  // A child is claimable only once its parent item has createdDocId set. If a planned
  // parent instead ends terminally (FAILED/SKIPPED), its descendants can never be
  // placed — a recursive CTE walks the plannedParentCodaPageId chain within each live
  // job and flips the whole blocked subtree PENDING → SKIPPED so the job can finalize.
  // Returns the affected jobIds; idempotent (guarded on status='PENDING').
  private async skipOrphansOfTerminalParents(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ jobId: string }[]>`
      WITH RECURSIVE blocked AS (
        SELECT c.id, c.job_id, c.coda_page_id
        FROM coda_import_job_items c
        JOIN coda_import_jobs j ON j.id = c.job_id
        JOIN coda_import_job_items p
          ON p.job_id = c.job_id AND p.coda_page_id = c.planned_parent_coda_page_id
        WHERE j.status IN (${LIVE_JOB_STATUS_SQL})
          -- Only fully-planned jobs: while a whole-doc import is still listing, a child
          -- whose parent hasn't been listed YET is not an orphan — don't cascade-skip it.
          AND j.planning_complete = true
          AND c.status = 'PENDING'
          AND c.planned_parent_coda_page_id IS NOT NULL
          AND p.status IN ('FAILED', 'SKIPPED')
        UNION
        SELECT c.id, c.job_id, c.coda_page_id
        FROM coda_import_job_items c
        JOIN blocked b
          ON c.job_id = b.job_id AND c.planned_parent_coda_page_id = b.coda_page_id
        WHERE c.status = 'PENDING'
      )
      UPDATE coda_import_job_items i
      SET status = 'SKIPPED',
          last_error = ${PARENT_SKIP_REASON},
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
      await this.prisma.codaImportJob
        .update({
          where: { id: jobId },
          data: { skippedItems: { increment: count } },
        })
        .catch((e) =>
          this.log.error(`bumping skippedItems for job ${jobId} failed`, e as Error),
        );
    }
    this.log.warn(
      `cascade-skipped ${rows.length} import item(s) blocked on a terminal parent across ${perJob.size} job(s)`,
    );
    return [...perJob.keys()];
  }

  // --- Per-item execution ---------------------------------------------------
  private async processItem(item: ClaimedItem): Promise<void> {
    // Greppable per-item context: reconstruct any item's fate from the logs alone.
    const ctx = `[import job=${item.jobId} item=${item.id} page=${item.codaPageId} seq=${item.seq} attempt=${item.attempts + 1}/t${item.transientAttempts + 1}]`;
    // The step in progress, surfaced on failure so a lastError pins WHERE it broke.
    let step = "claim";
    this.log.log(
      `${ctx} claimed lease=${this.leaseTtlMs}ms resumeDoc=${item.createdDocId ?? "-"}`,
    );
    try {
      step = "load-job";
      const job = await this.prisma.codaImportJob.findUnique({
        where: { id: item.jobId },
      });
      // Respect cancel, and quietly abandon a vanished job.
      if (!job || job.status === "CANCELED") {
        this.log.log(`${ctx} terminal=SKIPPED reason=job-canceled-or-gone`);
        await this.finishItem(item, "SKIPPED", "job canceled");
        return;
      }
      // A job with no target workspace can't place any doc — a config invariant the
      // enqueue guarantees; treat a missing one as a clean skip rather than a crash loop.
      if (!job.targetWorkspaceId) {
        this.log.warn(`${ctx} terminal=SKIPPED reason=target-workspace-missing`);
        await this.finishItem(item, "SKIPPED", "target workspace missing");
        return;
      }
      await this.markJobStarted(job.id);

      // The acting user (the enqueuer) authorizes documents.create AND supplies the
      // rtc-token subject/profile for replaceHtml. A vanished user falls back to a
      // system identity for the token — but documents.create still needs a real member
      // (its own permission re-check surfaces a gone user as an error → retried/failed).
      const actingUser = await this.resolveActingUser(
        job.createdById,
        job.targetWorkspaceId,
      );

      // (a) resolve the parent toddle-compose doc: top-level → workspace root (null);
      // else the sibling item's createdDocId (guaranteed set by the readiness gate).
      step = "resolve-parent";
      const parentDocId = await this.resolveParentDocId(item);

      // (b) create the doc (idempotent). If a prior attempt already created it,
      // createdDocId is set → reuse it (resume-safe, never a duplicate). Otherwise
      // create it and persist createdDocId IMMEDIATELY, BEFORE any content write, so a
      // crash mid-write resumes onto the same doc.
      let createdDocId = item.createdDocId;
      if (!createdDocId) {
        step = "create-doc";
        createdDocId = await this.createDocAndPersist(
          item,
          actingUser,
          job.targetWorkspaceId,
          parentDocId,
          ctx,
        );
        // A concurrent cancel/terminate flipped the item between the claim and the
        // persist — the doc may be orphaned (logged) — abort quietly.
        if (!createdDocId) {
          this.log.log(`${ctx} aborted reason=item-terminated-mid-flight`);
          return;
        }
      }

      // (c) provision the rtc row (idempotent; documents.create already best-efforts
      // this, so it's belt-and-braces before the content write).
      step = "init-rtc";
      await this.rtcInternal.initDocBestEffort(createdDocId);

      // (d) export the Coda page's HTML, sanitize it into our editor's subset, and
      // write it as the doc's whole body via rtc-server's content engine.
      step = "load-tokens";
      const pool = await this.poolForJob(job.credentialId);
      if (pool.length === 0) {
        // No token → can't export. PERMANENT (a config gap won't self-heal on retry);
        // fails at the small attempt cap with a clear reason.
        throw new HttpException(
          { error: "no Coda import token configured", status: 400 },
          500,
        );
      }
      step = "export";
      const rawHtml = await this.coda.exportPage(pool, job.codaDocId, item.codaPageId);
      step = "sanitize";
      const { html: cleanHtml, losses } = sanitizeCodaImportHtml(rawHtml);
      // IMAGES: the sanitizer keeps Coda's https image srcs AS-IS (passthrough of the
      // export URLs). Durable image rehosting into our own object storage is a FOLLOW-UP
      // (not this phase); surface any image loss on the item's lastError trail via logs.
      if (losses.length > 0) {
        this.log.log(
          `${ctx} sanitizer losses: ${losses.join("; ")} (image rehosting is a follow-up; Coda image URLs passed through as-is)`,
        );
      }
      step = "write-content";
      await this.rtcContent.replaceHtml(createdDocId, cleanHtml, actingUser);

      // Reverse Copy-to-Coda linkage: point the imported doc back at its origin Coda
      // page so Copy to Coda → Update existing prefills the origin URL. Best-effort —
      // the content already landed, so a linkage failure must NOT fail the item.
      step = "link-reverse-mapping";
      await this.linkReverseMapping(job, createdDocId, item, ctx);

      this.log.log(`${ctx} terminal=SUCCEEDED doc=${createdDocId}`);
      await this.finishItem(item, "SUCCEEDED", null);
    } catch (e) {
      await this.handleItemError(item, e, step);
    } finally {
      await this.maybeFinalizeJob(item.jobId).catch((e) =>
        this.log.error(`finalize import job ${item.jobId} failed`, e as Error),
      );
    }
  }

  // Resolve the parent toddle-compose doc id from the DB (survives restart). Null
  // planned parent → the workspace root (null parentId). Else → the sibling item's
  // persisted createdDocId, guaranteed set by the readiness gate.
  private async resolveParentDocId(item: ClaimedItem): Promise<string | null> {
    if (item.plannedParentCodaPageId === null) return null;
    const parent = await this.prisma.codaImportJobItem.findFirst({
      where: { jobId: item.jobId, codaPageId: item.plannedParentCodaPageId },
      select: { createdDocId: true },
    });
    if (!parent?.createdDocId) {
      // The readiness gate should prevent this; treat as retryable if it races.
      throw new Error("parent doc not resolved");
    }
    return parent.createdDocId;
  }

  // Create the toddle-compose doc, then persist its id BEFORE any content write (the
  // idempotency invariant): documents.create commits the doc row synchronously, so
  // persisting createdDocId right after means a crash before the content write resumes
  // onto the SAME doc rather than creating a second one. Aborts (returns null) if the
  // guarded persist matches 0 rows — the item was concurrently terminated (the doc we
  // just created may be orphaned, logged).
  private async createDocAndPersist(
    item: ClaimedItem,
    actingUser: AuthUser,
    workspaceId: string,
    parentDocId: string | null,
    ctx: string,
  ): Promise<string | null> {
    if (!(await this.stillLeased(item, ctx))) return null;
    const doc = await this.documents.create(actingUser, {
      workspaceId,
      parentId: parentDocId ?? undefined,
      title: item.codaPageName || "Untitled",
      type: "DOC",
    });
    if (!(await this.persistCreatedDocId(item, doc.id, ctx))) return null;
    this.log.log(
      `${ctx} step=create-doc doc=${doc.id} parent=${parentDocId ?? "root"}`,
    );
    return doc.id;
  }

  // Re-read the item's status/lease immediately before creating the doc: if it is no
  // longer RUNNING under THIS worker's lease (e.g. a concurrent cancel), don't create.
  private async stillLeased(item: ClaimedItem, ctx: string): Promise<boolean> {
    const current = await this.prisma.codaImportJobItem.findUnique({
      where: { id: item.id },
      select: { status: true, leasedBy: true },
    });
    const held =
      current?.status === "RUNNING" && current.leasedBy === this.workerId;
    if (!held) {
      this.log.log(
        `${ctx} step=create-doc aborted reason=item-no-longer-leased status=${current?.status ?? "gone"}`,
      );
    }
    return held;
  }

  // Persist the just-created createdDocId in a SHORT tx (no network I/O), guarded on the
  // item still being RUNNING under our lease: 0 rows → the item was concurrently
  // terminated, so the doc we created may be orphaned (logged) and the caller aborts.
  private async persistCreatedDocId(
    item: ClaimedItem,
    createdDocId: string,
    ctx: string,
  ): Promise<boolean> {
    const res = await this.prisma.codaImportJobItem.updateMany({
      where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
      data: { createdDocId },
    });
    const matched = res.count > 0;
    if (!matched) {
      this.log.warn(
        `${ctx} persist-createdDocId matched 0 rows (item no longer leased) — doc ${createdDocId} may be orphaned`,
      );
    }
    return matched;
  }

  // Build the AuthUser for documents.create + the rtc-token. Fetches the enqueuing user;
  // a vanished user falls back to a system identity carrying the original id (so the
  // rtc-token subject still points at the enqueuer) with a placeholder profile.
  private async resolveActingUser(
    userId: string,
    workspaceId: string,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, color: true },
    });
    if (user) {
      return { ...user, activeWorkspaceId: workspaceId };
    }
    return {
      id: userId,
      email: "import-worker@system.local",
      name: "Import Worker",
      color: "#f04c54",
      activeWorkspaceId: workspaceId,
    };
  }

  // --- Reverse Copy-to-Coda linkage ----------------------------------------
  // Wrap ensureImportScope + the mapping upsert so a linkage failure only warns —
  // the doc content already imported, so it must NEVER fail the import item.
  private async linkReverseMapping(
    job: ImportJob,
    createdDocId: string,
    item: ClaimedItem,
    ctx: string,
  ): Promise<void> {
    try {
      const scopeId = await this.ensureImportScope(job);
      if (!scopeId) {
        this.log.warn(
          `${ctx} reverse Copy-to-Coda linkage skipped (no target workspace or import token)`,
        );
        return;
      }
      await this.upsertImportMapping(
        createdDocId,
        scopeId,
        item.codaPageId,
        item.codaPageUrl ?? "",
      );
    } catch (e) {
      this.log.warn(
        `${ctx} reverse Copy-to-Coda linkage failed (content already imported): ${describeError(e)}`,
      );
    }
  }

  // Ensure the target workspace has ONE MigrationScope pointing back at the SOURCE Coda
  // doc, with an encrypted per-scope token — the destination Copy to Coda writes to.
  // Idempotent: one scope per (workspace, codaDoc, rootPage). A fast unlocked findFirst
  // covers the common already-exists case; the create is serialized by a pg advisory
  // lock (keyed on the same tuple) with a re-check inside the tx, so concurrent import
  // items never create duplicate scopes. Returns null when it can't be built (no target
  // workspace, or no import token to store).
  private async ensureImportScope(job: ImportJob): Promise<string | null> {
    if (!job.targetWorkspaceId) return null;
    // One import scope per (workspace, doc) — an imported workspace mirrors exactly one
    // Coda doc, so this is stable and needs NO Coda call on the hot path.
    const where = {
      workspaceId: job.targetWorkspaceId,
      codaDocId: job.codaDocId,
      deletedAt: null,
    };
    const existing = await this.prisma.migrationScope.findFirst({
      where,
      select: { id: true },
    });
    if (existing) return existing.id;

    const pool = await this.poolForJob(job.credentialId);
    const token = pool[0];
    if (!token) return null;

    // The imported page IS the scope root: copy-back nests under it and is subtree-constrained (imported-root override allowed by scope-validation). Whole-doc imports keep a null root.
    let scopeRootPageId: string | null = null;
    let sourceName = "Coda doc";
    if (job.codaRootPageId) {
      scopeRootPageId = job.codaRootPageId;
      const page = await this.coda
        .getPage(pool, job.codaDocId, job.codaRootPageId)
        .catch(() => null);
      sourceName = page?.name || sourceName;
    } else {
      const doc = await this.coda.getDoc(pool, job.codaDocId).catch(() => null);
      sourceName = doc?.name || sourceName;
    }
    const label = `Imported from Coda: ${sourceName}`;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${importScopeLockKey(
        job.targetWorkspaceId as string,
        job.codaDocId,
      )}))`;
      const found = await tx.migrationScope.findFirst({
        where,
        select: { id: true },
      });
      if (found) return found.id;
      const scope = await tx.migrationScope.create({
        data: {
          workspaceId: job.targetWorkspaceId as string,
          codaDocId: job.codaDocId,
          codaRootPageId: scopeRootPageId,
          codaRootUrl: job.codaDocUrl,
          label,
          createdById: job.createdById,
          tokens: {
            create: [
              {
                codaTokenEnc: this.cipher.encrypt(token),
                codaTokenHint: token.slice(-4),
              },
            ],
          },
        },
        select: { id: true },
      });
      return scope.id;
    });
  }

  // Upsert the (sourceDocId, scopeId) mapping so Copy-to-Coda's per-row prefill reads
  // codaPageUrl for Update-existing. This is the REVERSE direction: migratedSeq 0 is a
  // sentinel (prefill only reads codaPageUrl); the outbound worker overwrites it on a copy.
  private async upsertImportMapping(
    sourceDocId: string,
    scopeId: string,
    codaPageId: string,
    codaPageUrl: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.migrationMapping.upsert({
      where: { sourceDocId_scopeId: { sourceDocId, scopeId } },
      create: {
        sourceDocId,
        scopeId,
        codaPageId,
        codaPageUrl,
        migratedSeq: 0,
        lastMigratedAt: now,
      },
      update: { codaPageId, codaPageUrl, lastMigratedAt: now },
    });
  }

  // Terminal item transition, guarded on the item still being RUNNING under THIS
  // worker's lease so a lease steal / concurrent cancel never double-counts; the job
  // counter is bumped by the rows actually transitioned.
  private async finishItem(
    item: ClaimedItem,
    status: "SUCCEEDED" | "SKIPPED",
    lastError: string | null,
  ): Promise<void> {
    const counter = status === "SUCCEEDED" ? "succeededItems" : "skippedItems";
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.codaImportJobItem.updateMany({
        where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
        data: { status, lastError, leasedBy: null, leasedUntil: null },
      });
      if (res.count > 0) {
        // Bump the terminal counter, then reflect overall progress from the fresh
        // post-increment counts so the UI shows motion even before any item resolves.
        const updated = await tx.codaImportJob.update({
          where: { id: item.jobId },
          data: { [counter]: { increment: res.count } },
          select: {
            totalItems: true,
            succeededItems: true,
            failedItems: true,
            skippedItems: true,
          },
        });
        const done =
          updated.succeededItems + updated.failedItems + updated.skippedItems;
        await tx.codaImportJob.update({
          where: { id: item.jobId },
          data: {
            progressMessage: `Importing documents… (${done}/${updated.totalItems})`,
          },
        });
      }
    });
  }

  // On error: bump attempts; at the class's cap → FAILED (+lastError, +failedItems),
  // else release the lease back to PENDING for a later retry.
  //
  // TRANSIENT infra blips — rtc-server / Coda unreachable, 429, upstream 5xx, a Coda
  // export timeout — self-heal, so they release the lease back to PENDING after a
  // GROWING backoff and get a GENEROUS budget (maxTransientAttempts) that outlasts a
  // routine dependency blip; they STILL fail at that cap so a permanently-transient
  // condition can't retry forever. PERMANENT errors (Coda 4xx, a sanitizer/content
  // rejection, a lost permission) get a SMALL budget (maxAttempts) and NO backoff.
  private async handleItemError(
    item: ClaimedItem,
    e: unknown,
    step = "unknown",
  ): Promise<void> {
    const msg = describeError(e).slice(0, 1000);
    const ctx = `[import job=${item.jobId} item=${item.id} page=${item.codaPageId} seq=${item.seq}]`;
    const transient = isTransientError(e);
    const cls = transient ? "TRANSIENT" : "PERMANENT";
    // Separate budgets: each error kind bumps and checks ONLY its own counter.
    const attempts = transient ? item.attempts : item.attempts + 1;
    const transientAttempts = transient
      ? item.transientAttempts + 1
      : item.transientAttempts;
    const cap = transient ? this.maxTransientAttempts : this.maxAttempts;
    const count = transient ? transientAttempts : attempts;

    if (count >= cap) {
      this.log.warn(
        `${ctx} step=${step} class=${cls} terminal=FAILED attempts=${attempts} transientAttempts=${transientAttempts} cap=${cap} error="${msg}"`,
      );
      await this.failItem(item, attempts, transientAttempts, msg);
      return;
    }

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
    await this.prisma.codaImportJobItem
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
      .catch((err) => this.log.error("releasing import item for retry failed", err));
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
        const res = await tx.codaImportJobItem.updateMany({
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
          await tx.codaImportJob.update({
            where: { id: item.jobId },
            data: { failedItems: { increment: res.count } },
          });
        }
      })
      .catch((err) => this.log.error("recording FAILED import item failed", err));
  }

  // Stamp startedAt / flip QUEUED → RUNNING on first pickup (idempotent). PLAN already
  // did this, but keep it here so a resumed job with items but somehow still QUEUED
  // converges to RUNNING.
  private async markJobStarted(jobId: string): Promise<void> {
    await this.prisma.codaImportJob.updateMany({
      where: { id: jobId, startedAt: null },
      data: { startedAt: new Date() },
    });
    await this.prisma.codaImportJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
  }

  // When a job has no PENDING/RUNNING items left, finalize it so status == reality:
  //   SUCCEEDED ⟺ zero FAILED and zero SKIPPED (every planned page imported, or a
  //              0-page doc — nothing to import is still a clean success);
  //   PARTIAL   ⟺ something imported but something else failed/could-not-import;
  //   FAILED    ⟺ nothing imported and something failed/could-not-import.
  // Unlike the outbound migration there is no "clean empty" skip — an empty Coda page
  // still produces a (empty) doc → SUCCEEDED — so EVERY skip is tainting. Guarded on
  // QUEUED/RUNNING so a CANCELED (or already-finalized) job is never clobbered.
  async maybeFinalizeJob(jobId: string): Promise<void> {
    // Never finalize while planning is still running: a whole-doc import creates items
    // incrementally, so "no PENDING/RUNNING items right now" can just mean the next
    // batch hasn't been listed yet — finalizing here would wrongly mark it done.
    const job = await this.prisma.codaImportJob.findUnique({
      where: { id: jobId },
      select: { planningComplete: true },
    });
    if (!job || !job.planningComplete) return;

    const inFlight = await this.prisma.codaImportJobItem.count({
      where: { jobId, status: { in: [...PENDING_OR_RUNNING] } },
    });
    if (inFlight > 0) return;

    const [failed, succeeded, skipped] = await Promise.all([
      this.prisma.codaImportJobItem.count({ where: { jobId, status: "FAILED" } }),
      this.prisma.codaImportJobItem.count({ where: { jobId, status: "SUCCEEDED" } }),
      this.prisma.codaImportJobItem.count({ where: { jobId, status: "SKIPPED" } }),
    ]);
    const status =
      failed === 0 && skipped === 0
        ? "SUCCEEDED"
        : succeeded > 0
          ? "PARTIAL"
          : "FAILED";
    const res = await this.prisma.codaImportJob.updateMany({
      where: { id: jobId, status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
      // Clear the live activity line — terminal status badge + counts tell the story.
      data: { status, finishedAt: new Date(), progressMessage: null },
    });
    if (res.count > 0) {
      const summary = `${succeeded} succeeded, ${failed} failed, ${skipped} skipped`;
      await this.logEvent(
        jobId,
        status === "FAILED"
          ? `Import failed — ${summary}`
          : `Import completed — ${summary}`,
      );
      this.log.log(
        `[import job=${jobId}] finalized=${status} succeeded=${succeeded} failed=${failed} skipped=${skipped}`,
      );
    }
  }
}

// Order a flat page list depth-first from each page's parent ref, so a parent always
// precedes its children (seq order) and children carry their parent's Coda page id.
// Pages Coda doesn't return a parent for (or an unresolvable parent) are treated as
// top-level. Bounded/visited-guarded so a malformed cycle can't loop.
//
// rootPageId selects the import ROOT: null (whole-doc) imports every page, top-level
// Coda pages becoming top-level docs; a page id imports that page ITSELF as a top-level
// doc PLUS its whole subtree nested under it (the page is the folder's first doc, its
// children hang off it). Each emitted page keeps its REAL Coda parent as
// plannedParentCodaPageId (null when the parent isn't an item — top-level pages in
// whole-doc mode, and the root page itself in page-root mode). The root page is emitted
// first so its children gate on an existing parent item.
export function orderDepthFirst(
  pages: {
    id: string;
    name?: string;
    browserLink?: string;
    parent?: { id?: string } | null;
  }[],
  rootPageId: string | null = null,
): PlannedItem[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const childrenOf = new Map<string | null, typeof pages>();
  for (const p of pages) {
    // A parent ref that isn't in this doc's page set → treat as top-level.
    const parentId =
      p.parent?.id && byId.has(p.parent.id) ? p.parent.id : null;
    const bucket = childrenOf.get(parentId) ?? [];
    bucket.push(p);
    childrenOf.set(parentId, bucket);
  }
  const out: PlannedItem[] = [];
  const seen = new Set<string>();
  const emit = (p: (typeof pages)[number], parent: string | null): void => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push({
      codaPageId: p.id,
      codaPageName: p.name ?? "Untitled",
      codaPageUrl: p.browserLink ?? null,
      plannedParentCodaPageId: parent,
    });
  };
  // Emit each child under `parentId` keeping its real parent, then recurse.
  const walk = (parentId: string | null): void => {
    for (const p of childrenOf.get(parentId) ?? []) {
      emit(p, parentId);
      walk(p.id);
    }
  };
  if (rootPageId !== null) {
    // Page-root: the root page becomes a top-level doc; its subtree nests under it.
    const rootPage = byId.get(rootPageId);
    if (rootPage) emit(rootPage, null);
    walk(rootPageId);
  } else {
    // Whole-doc: walk from the top level, then append any page orphaned by a cyclic
    // parent chain (as top-level) so nothing is silently dropped.
    walk(null);
    for (const p of pages) emit(p, null);
  }
  return out;
}

// Stable key for the per-destination advisory lock so concurrent import items never
// create duplicate reverse-linkage scopes for the same (workspace, codaDoc).
function importScopeLockKey(workspaceId: string, codaDocId: string): string {
  return `coda-import-scope:${workspaceId}:${codaDocId}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

// A useful failure reason for lastError. A CodaClient/RtcContentClient HttpException
// carries a structured payload (error + status + truncated upstream body); surface that
// instead of the generic HttpException.message ("Http Exception").
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
// permanent budget) vs. a PERMANENT failure. Transient = a dependency is unreachable/
// overloaded and should self-heal: rtc-server / Coda unreachable, Coda 429 (rate
// limited), a Coda export timeout (async export took too long), or any upstream 5xx.
// Everything else — a Coda 4xx (e.g. 404 gone page), a content/sanitizer rejection —
// is permanent.
export function isTransientError(e: unknown): boolean {
  if (!(e instanceof HttpException)) return false;
  const r = e.getResponse();
  const payload =
    r && typeof r === "object" ? (r as { error?: string; status?: number }) : {};
  const error = payload.error ?? "";
  if (/unreachable/i.test(error)) return true;
  if (error === "coda rate limited" || error === "coda export timed out") {
    return true;
  }
  if (typeof payload.status === "number" && payload.status >= 500) return true;
  return false;
}
