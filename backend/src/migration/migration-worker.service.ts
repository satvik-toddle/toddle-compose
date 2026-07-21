import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import { CodaClient } from "../coda/coda.client";
import { CodaCredentialsService } from "./coda-credentials.service";

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
  // Point-in-time snapshot cursor captured at enqueue; null = legacy (fetch latest).
  enqueuedSeq: number | null;
  attempts: number;
  seq: number;
}

const PENDING_OR_RUNNING = ["PENDING", "RUNNING"] as const;
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
  private readonly maxHtmlBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly documents: DocumentsService,
    private readonly rtc: RtcInternalClient,
    private readonly coda: CodaClient,
    private readonly credentials: CodaCredentialsService,
  ) {
    this.leaseTtlMs = this.config.get("MIGRATION_LEASE_TTL_MS", { infer: true });
    this.batchSize = this.config.get("MIGRATION_BATCH_SIZE", { infer: true });
    this.maxAttempts = this.config.get("MIGRATION_MAX_ITEM_ATTEMPTS", {
      infer: true,
    });
    this.maxHtmlBytes = this.config.get("CODA_MAX_HTML_BYTES", { infer: true });
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
        if (items.length === 0) return;
        for (const item of items) {
          if (this.stopped) return;
          await this.processItem(item);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  // --- The integrity core: atomic lease claim (D9) --------------------------
  // A single conditional UPDATE flips a batch of READY items to RUNNING under
  // this worker's lease. READY = the job is live (QUEUED/RUNNING) AND the item is
  // PENDING (or RUNNING with an expired lease — crash reclaim) AND its parent is
  // resolved (no planned parent, or the sibling item with that sourceDocId already
  // has a codaPageId). That readiness gate enforces depth-first ordering AND
  // survives restart, because parent resolution is read from the DB, not memory.
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
        WHERE j.status IN ('QUEUED', 'RUNNING')
          AND (
            c.status = 'PENDING'
            OR (c.status = 'RUNNING' AND c.leased_until IS NOT NULL AND c.leased_until < now())
          )
          AND (
            c.planned_parent_doc_id IS NULL
            OR EXISTS (
              SELECT 1 FROM migration_job_items p
              WHERE p.job_id = c.job_id
                AND p.source_doc_id = c.planned_parent_doc_id
                AND p.coda_page_id IS NOT NULL
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
        i.enqueued_seq AS "enqueuedSeq",
        i.attempts,
        i.seq
    `;
  }

  // --- Per-item execution ---------------------------------------------------
  private async processItem(item: ClaimedItem): Promise<void> {
    try {
      const job = await this.prisma.migrationJob.findUnique({
        where: { id: item.jobId },
      });
      // (a) respect cancel, and quietly abandon a vanished job/scope (D8).
      if (!job || job.status === "CANCELED") {
        await this.finishItem(item, "SKIPPED", "job canceled");
        return;
      }
      await this.markJobStarted(job.id);

      // (b) run-time permission re-check (P2) + source existence (D7): a doc that
      // was deleted or had its grant revoked since enqueue is SKIPPED, never pushed.
      try {
        await this.documents.assertReadable(job.createdById, item.sourceDocId);
      } catch {
        await this.finishItem(item, "SKIPPED", "source not readable at run time");
        return;
      }

      // (c) resolve the Coda destination + parent page.
      const scope = await this.prisma.migrationScope.findFirst({
        where: { id: job.scopeId, deletedAt: null },
        select: { codaDocId: true, codaRootPageId: true },
      });
      if (!scope) {
        await this.finishItem(item, "SKIPPED", "destination removed");
        return;
      }
      const parentPageId = await this.resolveCodaParent(item, scope.codaRootPageId);

      // (d) fetch the constrained HTML AS OF the enqueue snapshot (point-in-time:
      // push the version the user reviewed, not whatever is live now); null → latest.
      // Never push a blank doc (D7).
      const content = await this.rtc.getCodaHtml(
        item.sourceDocId,
        item.enqueuedSeq ?? undefined,
      );
      if (content.isEmpty) {
        await this.finishItem(item, "SKIPPED", "source is empty");
        return;
      }

      // (e) decrypted token pool for the destination (least-loaded pacing built in).
      const pool = await this.credentials.getTokenPool(job.scopeId);

      // (f/g) create-or-override under the per-pair advisory lock; codaPageId is
      // committed here, BEFORE awaitMutation (C3). Returns the requestId to gate on.
      const chunks = chunkHtmlByBytes(content.html, this.maxHtmlBytes);
      const built = await this.createOrOverride(
        item,
        job.scopeId,
        scope.codaDocId,
        parentPageId,
        pool,
        chunks[0],
      );

      // (H2) gate the create before descending; (H8) then stream the remaining
      // chunks in sequence, each paced + awaited. Skipped entirely on resume.
      if (built.requestId) {
        await this.coda.awaitMutation(pool, built.requestId);
        for (const chunk of chunks.slice(1)) {
          if (this.stopped) return;
          const r = await this.coda.appendPageContent(
            pool,
            scope.codaDocId,
            built.codaPageId,
            chunk,
          );
          await this.coda.awaitMutation(pool, r.requestId);
        }
      }

      // (g) upsert the mapping (latest-wins) under the advisory lock, and (h/D1/D2)
      // record the head seq we actually read + mark the item SUCCEEDED.
      const url = await this.resolvePageUrl(
        pool,
        scope.codaDocId,
        built.codaPageId,
      );
      await this.upsertMapping(item.sourceDocId, job.scopeId, {
        codaPageId: built.codaPageId,
        codaPageUrl: url,
        migratedSeq: content.headSeq,
      });
      await this.finishItem(item, "SUCCEEDED", null, {
        codaPageId: built.codaPageId,
        migratedSeq: content.headSeq,
      });
    } catch (e) {
      await this.handleItemError(item, e);
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

  // Create-vs-override under a pg advisory xact lock keyed on (sourceDocId, scopeId)
  // (D6) so two overlapping jobs can't tear the mapping / interleave a create for the
  // same pair. codaPageId is persisted inside this tx — committed BEFORE the caller
  // awaits the async mutation (C3). Idempotent resume: if codaPageId is already set
  // (created before a crash), creation is SKIPPED and the page reused.
  private async createOrOverride(
    item: ClaimedItem,
    scopeId: string,
    codaDocId: string,
    parentPageId: string | undefined,
    pool: string[],
    firstChunk: string,
  ): Promise<{ codaPageId: string; requestId: string | null }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(item.sourceDocId, scopeId)}))`;

        // Re-read inside the lock so a crash-resume (codaPageId already persisted)
        // reuses the existing page instead of creating a duplicate (C3).
        const fresh = await tx.migrationJobItem.findUnique({
          where: { id: item.id },
          select: { codaPageId: true },
        });
        let codaPageId = fresh?.codaPageId ?? null;
        let requestId: string | null = null;

        if (item.override && item.targetCodaPageId) {
          // H3: wholesale replace in place — no move, no reparent.
          const r = await this.coda.replacePageContent(
            pool,
            codaDocId,
            item.targetCodaPageId,
            firstChunk,
          );
          codaPageId = item.targetCodaPageId;
          requestId = r.requestId;
        } else if (codaPageId) {
          // Idempotent resume — the page already exists; do not create again (C3).
          requestId = null;
        } else {
          const r = await this.coda.createPage(pool, codaDocId, {
            name: item.title,
            parentPageId,
            html: firstChunk,
          });
          codaPageId = r.id;
          requestId = r.requestId;
        }

        // Persist codaPageId immediately — this commit precedes awaitMutation (C3).
        await tx.migrationJobItem.update({
          where: { id: item.id },
          data: { codaPageId },
        });
        return { codaPageId: codaPageId as string, requestId };
      },
      { timeout: CREATE_TX_TIMEOUT_MS },
    );
  }

  // Upsert the latest-wins (sourceDocId, scopeId) mapping under the same advisory
  // lock so concurrent jobs never produce a torn/untracked mapping (D6).
  private async upsertMapping(
    sourceDocId: string,
    scopeId: string,
    data: { codaPageId: string; codaPageUrl: string; migratedSeq: number },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(sourceDocId, scopeId)}))`;
      const now = new Date();
      await tx.migrationMapping.upsert({
        where: { sourceDocId_scopeId: { sourceDocId, scopeId } },
        create: { sourceDocId, scopeId, ...data, lastMigratedAt: now },
        update: { ...data, lastMigratedAt: now },
      });
    });
  }

  // Best-effort browser URL for the mapping (prefill display). A read failure
  // must not fail the migration — fall back to the doc-level link.
  private async resolvePageUrl(
    pool: string[],
    codaDocId: string,
    pageId: string,
  ): Promise<string> {
    try {
      const page = await this.coda.getPage(pool, codaDocId, pageId);
      if (page.browserLink) return page.browserLink;
    } catch {
      // fall through
    }
    return `https://coda.io/d/${codaDocId}`;
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

  // On error: bump attempts; at the cap → FAILED (+lastError, +failedItems), else
  // release the lease back to PENDING for a later retry (CodaClient retries 429s).
  private async handleItemError(item: ClaimedItem, e: unknown): Promise<void> {
    const attempts = item.attempts + 1;
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    if (attempts >= this.maxAttempts) {
      this.log.warn(
        `item ${item.id} FAILED after ${attempts} attempt(s): ${msg}`,
      );
      await this.prisma
        .$transaction(async (tx) => {
          const res = await tx.migrationJobItem.updateMany({
            where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
            data: {
              status: "FAILED",
              attempts,
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
    } else {
      this.log.warn(
        `item ${item.id} attempt ${attempts} errored, releasing for retry: ${msg}`,
      );
      await this.prisma.migrationJobItem
        .updateMany({
          where: { id: item.id, status: "RUNNING", leasedBy: this.workerId },
          data: {
            status: "PENDING",
            attempts,
            lastError: msg,
            leasedBy: null,
            leasedUntil: null,
          },
        })
        .catch((err) => this.log.error("releasing item for retry failed", err));
    }
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

  // When a job has no PENDING/RUNNING items left, finalize it: all-succeeded →
  // SUCCEEDED, some succeeded + some failed → PARTIAL, all failed → FAILED. Guarded
  // on QUEUED/RUNNING so a CANCELED (or already-finalized) job is never clobbered.
  private async maybeFinalizeJob(jobId: string): Promise<void> {
    const inFlight = await this.prisma.migrationJobItem.count({
      where: { jobId, status: { in: [...PENDING_OR_RUNNING] } },
    });
    if (inFlight > 0) return;

    const [failed, succeeded] = await Promise.all([
      this.prisma.migrationJobItem.count({ where: { jobId, status: "FAILED" } }),
      this.prisma.migrationJobItem.count({
        where: { jobId, status: "SUCCEEDED" },
      }),
    ]);
    const status =
      failed === 0 ? "SUCCEEDED" : succeeded > 0 ? "PARTIAL" : "FAILED";
    await this.prisma.migrationJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status, finishedAt: new Date() },
    });
  }
}

// Stable string key for the per-pair pg advisory lock (D6).
function lockKey(sourceDocId: string, scopeId: string): string {
  return `migration:${sourceDocId}:${scopeId}`;
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
