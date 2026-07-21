import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  MigrationJob,
  MigrationJobItem,
  MigrationMapping,
  Prisma,
} from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { ActiveRealmService } from "../realm/active-realm.service";
import { DocumentsService } from "../documents/documents.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";
import { ScopeValidationService } from "./scope-validation.service";
import { PARENT_SKIP_REASON } from "./migration-worker.service";
import { EnqueueMigrationJobDto, MigrationPlanItemDto } from "./dto";

// A job is still in-flight (blocks a double-submit, is cancelable) in these states.
const NON_TERMINAL_JOB_STATUSES = ["QUEUED", "RUNNING"] as const;
// Items the worker hasn't finalized — canceled → SKIPPED, and the retry target.
const NON_TERMINAL_ITEM_STATUSES = ["PENDING", "RUNNING"] as const;

interface JobSummaryView {
  id: string;
  workspaceId: string;
  scopeId: string;
  sourceRootDocId: string;
  status: MigrationJob["status"];
  totalItems: number;
  succeededItems: number;
  failedItems: number;
  skippedItems: number;
  error: string | null;
  createdById: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// Per-item execution state — never exposes the worker lease (leasedBy/leasedUntil).
interface JobItemView {
  id: string;
  sourceDocId: string;
  plannedParentDocId: string | null;
  title: string;
  targetCodaPageId: string | null;
  override: boolean;
  codaPageId: string | null;
  migratedSeq: number | null;
  status: MigrationJobItem["status"];
  attempts: number;
  lastError: string | null;
  seq: number;
}

// A saved (sourceDocId, scopeId) mapping the modal prefills a destination from.
interface MappingView {
  sourceDocId: string;
  codaPageId: string;
  codaPageUrl: string;
  migratedSeq: number;
  lastMigratedAt: Date;
}

// A doc's live Coda destination(s) for the "Open in Coda" menu action — one row per
// non-deleted scope this doc has been migrated to, with the scope's label to disambiguate.
interface DocCodaMappingView {
  codaPageUrl: string;
  scopeId: string;
  scopeLabel: string;
  lastMigratedAt: Date;
}

@Injectable()
export class MigrationJobsService {
  private readonly log = new Logger("MigrationJobs");

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly realm: ActiveRealmService,
    // forwardRef: DocumentsService ↔ MigrationJobsService form a module cycle
    // (DocumentsService.remove calls skipItemsForDeletedDocs).
    @Inject(forwardRef(() => DocumentsService))
    private readonly documents: DocumentsService,
    private readonly scopeValidation: ScopeValidationService,
    private readonly rtc: RtcInternalClient,
  ) {}

  // POST /migration-scopes/:scopeId/jobs — snapshot the arranged plan into a QUEUED job.
  async enqueue(
    userId: string,
    scopeId: string,
    dto: EnqueueMigrationJobDto,
  ): Promise<{ jobId: string }> {
    const scope = await this.prisma.migrationScope.findFirst({
      where: { id: scopeId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!scope) throw new NotFoundException("destination not found");

    // P8b: workspace EDIT-or-above; grant-only guests (null effective role) are blocked.
    await this.authz.requireWorkspaceRole(userId, scope.workspaceId, "EDIT");

    // Drop unchecked rows; a plan must still contain something to migrate.
    const included = dto.items.filter((i) => i.include);
    if (included.length === 0) {
      throw new BadRequestException("no documents selected for migration");
    }

    const ids = included.map((i) => i.sourceDocId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException("duplicate sourceDocId in the migration plan");
    }

    // Root = explicit request value, else the single row with a null planned parent.
    const rootDocId =
      dto.sourceRootDocId ??
      included.find((i) => (i.plannedParentDocId ?? null) === null)?.sourceDocId;
    if (!rootDocId) {
      throw new BadRequestException("could not determine the subtree root");
    }
    if (!included.some((i) => i.sourceDocId === rootDocId)) {
      throw new BadRequestException(
        "sourceRootDocId is not among the included items",
      );
    }

    // Per-doc read filter (C4/P5) + DOC-only + same-workspace, sequentially so the
    // first offending row is named. Coda calls (override URLs) run outside the tx.
    const targetByDoc = new Map<string, string>();
    for (const item of included) {
      let meta: { workspaceId: string; type: string };
      try {
        meta = await this.documents.assertReadable(userId, item.sourceDocId);
      } catch {
        throw new ForbiddenException(
          `document ${item.sourceDocId} is not readable`,
        );
      }
      if (meta.workspaceId !== scope.workspaceId) {
        throw new BadRequestException(
          `document ${item.sourceDocId} is not in this destination's workspace`,
        );
      }
      if (meta.type === "SHEET") {
        throw new BadRequestException(
          `document ${item.sourceDocId} is a SHEET; only DOC documents can be migrated`,
        );
      }

      if (item.destinationUrl) {
        try {
          const { codaPageId } = await this.scopeValidation.validateDestinationUrl(
            scopeId,
            item.destinationUrl,
          );
          targetByDoc.set(item.sourceDocId, codaPageId);
        } catch (e) {
          const reason = e instanceof Error ? e.message : "out of scope";
          throw new BadRequestException(
            `destination URL for document ${item.sourceDocId} is invalid: ${reason}`,
          );
        }
      }
    }

    // Point-in-time snapshot (D2): FREEZE each doc's sanitized HTML NOW, at enqueue, so the worker
    // pushes the exact Start-Copy content verbatim — immune to later edits/compaction AND to a
    // run-time rtc outage (nothing is re-extracted at run). An empty doc snapshots to null and is
    // skipped at run (worker's empty check). Reads run concurrently and OUTSIDE the tx (mirrors the
    // Coda-validation reads above). Fail-closed: the point-in-time guarantee depends on capturing
    // this snapshot, so if any extraction fails we reject the whole enqueue rather than silently fall
    // back to a run-time (latest) sync.
    const snapshotByDoc = new Map<
      string,
      { snapshotHtml: string | null; enqueuedSeq: number }
    >();
    await Promise.all(
      included.map(async (item) => {
        try {
          const { html, headSeq, isEmpty } = await this.rtc.getCodaHtml(
            item.sourceDocId,
          );
          snapshotByDoc.set(item.sourceDocId, {
            snapshotHtml: isEmpty ? null : html,
            enqueuedSeq: headSeq,
          });
        } catch {
          throw new ServiceUnavailableException(
            `could not capture the content snapshot for document ${item.sourceDocId}; please retry`,
          );
        }
      }),
    );

    // Re-parent any included item whose planned parent was UNchecked, up to the
    // nearest still-included ancestor (fix: an excluded mid-tree parent would leave
    // its kept children pointing at a parent with no item row — unclaimable orphans
    // that never terminate). The root is always included, so the walk terminates.
    const reparented = reparentToIncludedAncestors(included, dto.items, rootDocId);

    // Depth-first order → the seq the worker processes parents before children.
    const ordered = orderDepthFirst(reparented, rootDocId);

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent enqueues for the same (scope, root) BEFORE the guard read,
      // so a double-submit can't slip two live jobs past the findFirst check (there is
      // no unique constraint) and duplicate the whole subtree in Coda. The loser blocks
      // here, then sees the winner's job below and gets the 409-style rejection.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${enqueueLockKey(scopeId, rootDocId)}))`;
      // Double-submit guard (#17): one live job per (scope, subtree root).
      const existing = await tx.migrationJob.findFirst({
        where: {
          scopeId,
          sourceRootDocId: rootDocId,
          status: { in: [...NON_TERMINAL_JOB_STATUSES] },
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          "a migration for this document is already queued or running",
        );
      }

      const job = await tx.migrationJob.create({
        data: {
          workspaceId: scope.workspaceId,
          scopeId,
          sourceRootDocId: rootDocId,
          createdById: userId,
          status: "QUEUED",
          totalItems: ordered.length,
          items: {
            create: ordered.map((it, seq) => ({
              sourceDocId: it.sourceDocId,
              plannedParentDocId: it.plannedParentDocId ?? null,
              title: it.title,
              targetCodaPageId: targetByDoc.get(it.sourceDocId) ?? null,
              override: !!it.destinationUrl,
              snapshotHtml: snapshotByDoc.get(it.sourceDocId)?.snapshotHtml ?? null,
              enqueuedSeq: snapshotByDoc.get(it.sourceDocId)?.enqueuedSeq ?? null,
              status: "PENDING",
              seq,
            })),
          },
        },
        select: { id: true },
      });
      // Enqueue summary: how many items, and how many bytes of frozen snapshot were
      // captured (D2) — so a job's origin is reconstructable from the logs.
      let snapshotBytes = 0;
      let emptyDocs = 0;
      for (const s of snapshotByDoc.values()) {
        if (s.snapshotHtml === null) emptyDocs++;
        else snapshotBytes += Buffer.byteLength(s.snapshotHtml, "utf8");
      }
      this.log.log(
        `[job=${job.id}] enqueued scope=${scopeId} root=${rootDocId} items=${ordered.length} emptyDocs=${emptyDocs} snapshotBytes=${snapshotBytes} by=${userId}`,
      );
      return { jobId: job.id };
    });
  }

  // GET /migration-scopes/:scopeId/mappings?docIds= — existing (sourceDocId, scopeId)
  // mappings for the given docs, so the modal can prefill each row's destination for
  // the selected scope. Same gate as enqueue (workspace EDIT+); only docs that already
  // have a mapping are returned. Never exposes tokens or job internals.
  async listMappings(
    userId: string,
    scopeId: string,
    docIds: string[],
  ): Promise<MappingView[]> {
    const scope = await this.prisma.migrationScope.findFirst({
      where: { id: scopeId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!scope) throw new NotFoundException("destination not found");

    await this.authz.requireWorkspaceRole(userId, scope.workspaceId, "EDIT");

    if (docIds.length === 0) return [];

    const mappings = await this.prisma.migrationMapping.findMany({
      where: { scopeId, sourceDocId: { in: docIds } },
    });
    return mappings.map(toMappingView);
  }

  // GET /documents/:docId/coda-mappings — this doc's Coda destination(s) for the
  // "Open in Coda" action: one row per non-deleted scope in the doc's workspace the
  // doc has been migrated to, with the scope label. Same EDIT+ gate as Copy-to-Coda.
  async listDocCodaMappings(
    userId: string,
    docId: string,
  ): Promise<DocCodaMappingView[]> {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: { workspaceId: true },
    });
    if (!doc) throw new NotFoundException("document not found");

    await this.authz.requireWorkspaceRole(userId, doc.workspaceId, "EDIT");

    const mappings = await this.prisma.migrationMapping.findMany({
      where: {
        sourceDocId: docId,
        scope: { workspaceId: doc.workspaceId, deletedAt: null },
      },
      include: { scope: { select: { id: true, label: true } } },
      orderBy: { lastMigratedAt: "desc" },
    });
    return mappings.map((m) => ({
      codaPageUrl: m.codaPageUrl,
      scopeId: m.scope.id,
      scopeLabel: m.scope.label,
      lastMigratedAt: m.lastMigratedAt,
    }));
  }

  // GET /migration-jobs?workspaceId= — workspace runs (EDIT+; non-admins see only
  // their own) or, with no workspaceId, the org-wide admin-console listing (realm admin).
  async list(userId: string, workspaceId?: string): Promise<JobSummaryView[]> {
    let where: Prisma.MigrationJobWhereInput;
    if (workspaceId) {
      const role = await this.authz.requireWorkspaceRole(
        userId,
        workspaceId,
        "EDIT",
      );
      where =
        role === "ADMIN" ? { workspaceId } : { workspaceId, createdById: userId };
    } else {
      await this.authz.requireRealmRole(userId, "MAINTAINER");
      where = { workspace: { realmId: this.realm.id } };
    }
    const jobs = await this.prisma.migrationJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return jobs.map(toJobSummary);
  }

  // GET /migration-jobs/:jobId — job + its items, gated by the job's workspace (P6).
  async get(
    userId: string,
    jobId: string,
  ): Promise<JobSummaryView & { items: JobItemView[] }> {
    const job = await this.prisma.migrationJob.findUnique({
      where: { id: jobId },
      include: { items: { orderBy: { seq: "asc" } } },
    });
    if (!job) throw new NotFoundException("migration job not found");

    // EDIT+ on the job's workspace, and (unless ADMIN) only the caller's own runs.
    const role = await this.authz.requireWorkspaceRole(
      userId,
      job.workspaceId,
      "EDIT",
    );
    if (role !== "ADMIN" && job.createdById !== userId) {
      throw new NotFoundException("migration job not found");
    }
    return { ...toJobSummary(job), items: job.items.map(toJobItem) };
  }

  // POST /migration-jobs/:jobId/cancel — stop processing: job → CANCELED, its
  // non-terminal items → SKIPPED (the worker re-checks status before each item).
  async cancel(userId: string, jobId: string): Promise<JobSummaryView> {
    const job = await this.requireJobManage(userId, jobId);
    if (!isNonTerminalJob(job.status)) {
      throw new BadRequestException("only a queued or running job can be canceled");
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const skipped = await tx.migrationJobItem.updateMany({
        where: { jobId, status: { in: [...NON_TERMINAL_ITEM_STATUSES] } },
        data: { status: "SKIPPED", leasedBy: null, leasedUntil: null },
      });
      return tx.migrationJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          finishedAt: now,
          skippedItems: { increment: skipped.count },
        },
      });
    });
    return toJobSummary(updated);
  }

  // POST /migration-jobs/:jobId/retry — re-drive FAILED items AND orphaned
  // descendants (SKIPPED with reason "parent did not migrate") → PENDING (clear
  // lease/lastError, keep codaPageId so a half-done item stays idempotent), job →
  // QUEUED for the worker. Re-driving the parent-skipped orphans lets a retry, after
  // the parent has since succeeded, recover a descendant that could not be placed
  // the first time. Intentional skips (empty/unreadable source) are NOT re-driven.
  async retry(userId: string, jobId: string): Promise<JobSummaryView> {
    const job = await this.requireJobManage(userId, jobId);
    if (isNonTerminalJob(job.status)) {
      throw new BadRequestException("job is still in progress; cancel it first");
    }
    const resetData = {
      status: "PENDING" as const,
      attempts: 0,
      lastError: null,
      leasedBy: null,
      leasedUntil: null,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const failedReset = await tx.migrationJobItem.updateMany({
        where: { jobId, status: "FAILED" },
        data: resetData,
      });
      // Orphans cascade-skipped because their parent ended terminally — recoverable
      // now that a retry may re-place the parent first. Only this exact reason, so
      // intentional skips (source empty/unreadable) are left terminal.
      const orphanReset = await tx.migrationJobItem.updateMany({
        where: { jobId, status: "SKIPPED", lastError: PARENT_SKIP_REASON },
        data: resetData,
      });
      if (failedReset.count === 0 && orphanReset.count === 0) {
        throw new BadRequestException("no failed items to retry");
      }
      return tx.migrationJob.update({
        where: { id: jobId },
        data: {
          status: "QUEUED",
          error: null,
          finishedAt: null,
          failedItems: { decrement: failedReset.count },
          skippedItems: { decrement: orphanReset.count },
        },
      });
    });
    return toJobSummary(updated);
  }

  // Called by DocumentsService.remove INSIDE its delete transaction (D7): flip this
  // deleted subtree's still-claimable items to SKIPPED, bump each affected job's
  // skippedItems by the number flipped (so counters stay accurate, matching every
  // other skip path), and return the affected jobIds. The caller finalizes those jobs
  // AFTER commit — the delete may have removed the last claimable item, so the worker
  // tick would otherwise never finalize the job and it would hang non-terminal forever.
  async skipItemsForDeletedDocs(
    tx: Prisma.TransactionClient,
    docIds: string[],
  ): Promise<string[]> {
    if (docIds.length === 0) return [];
    const items = await tx.migrationJobItem.findMany({
      where: {
        sourceDocId: { in: docIds },
        status: { in: [...NON_TERMINAL_ITEM_STATUSES] },
      },
      select: { id: true, jobId: true },
    });
    if (items.length === 0) return [];
    await tx.migrationJobItem.updateMany({
      where: {
        id: { in: items.map((i) => i.id) },
        status: { in: [...NON_TERMINAL_ITEM_STATUSES] },
      },
      data: {
        status: "SKIPPED",
        lastError: "source document deleted",
        leasedBy: null,
        leasedUntil: null,
      },
    });
    const perJob = new Map<string, number>();
    for (const it of items) perJob.set(it.jobId, (perJob.get(it.jobId) ?? 0) + 1);
    for (const [jobId, count] of perJob) {
      await tx.migrationJob.update({
        where: { id: jobId },
        data: { skippedItems: { increment: count } },
      });
    }
    return [...perJob.keys()];
  }

  // --- internals ------------------------------------------------------------

  // Load a job and assert the caller may cancel/retry it: its creator, or a
  // workspace ADMIN (realm OWNER/MAINTAINER overlay as ADMIN via effectiveWorkspaceRole).
  private async requireJobManage(
    userId: string,
    jobId: string,
  ): Promise<MigrationJob> {
    const job = await this.prisma.migrationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException("migration job not found");
    if (job.createdById !== userId) {
      await this.authz.requireWorkspaceRole(userId, job.workspaceId, "ADMIN");
    }
    return job;
  }
}

function isNonTerminalJob(status: MigrationJob["status"]): boolean {
  return (NON_TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

// Stable string key for the per-(scope, root) enqueue advisory lock.
function enqueueLockKey(scopeId: string, rootDocId: string): string {
  return `migration-enqueue:${scopeId}:${rootDocId}`;
}

// Re-parent every included item whose planned parent was NOT included, to the nearest
// included ancestor — walking the FULL plan (include:false rows included) so the chain
// is complete. Cycles / a chain that never reaches an included node fall back to the
// root (always included). Returns a new list; unaffected items are returned as-is.
function reparentToIncludedAncestors(
  included: MigrationPlanItemDto[],
  all: MigrationPlanItemDto[],
  rootDocId: string,
): MigrationPlanItemDto[] {
  const includedIds = new Set(included.map((i) => i.sourceDocId));
  const parentOf = new Map<string, string | null>();
  for (const it of all) parentOf.set(it.sourceDocId, it.plannedParentDocId ?? null);

  // Walk up from `start` to the first included ancestor, guarding against cycles.
  const nearestIncluded = (start: string | null): string | null => {
    const seen = new Set<string>();
    let cur = start;
    while (cur !== null && !seen.has(cur)) {
      if (includedIds.has(cur)) return cur;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return null;
  };

  return included.map((it) => {
    const parent = it.plannedParentDocId ?? null;
    if (it.sourceDocId === rootDocId || parent === null || includedIds.has(parent)) {
      return it;
    }
    return { ...it, plannedParentDocId: nearestIncluded(parent) ?? rootDocId };
  });
}

// Depth-first over the arranged parent links from the root; unreachable rows
// (defensive: a stray planned parent) are appended in input order so none is lost.
function orderDepthFirst(
  items: MigrationPlanItemDto[],
  rootDocId: string,
): MigrationPlanItemDto[] {
  const byParent = new Map<string, MigrationPlanItemDto[]>();
  for (const it of items) {
    const key = it.plannedParentDocId ?? " root";
    const bucket = byParent.get(key);
    if (bucket) bucket.push(it);
    else byParent.set(key, [it]);
  }

  const result: MigrationPlanItemDto[] = [];
  const seen = new Set<string>();
  const visit = (docId: string) => {
    for (const child of byParent.get(docId) ?? []) {
      if (seen.has(child.sourceDocId)) continue;
      seen.add(child.sourceDocId);
      result.push(child);
      visit(child.sourceDocId);
    }
  };

  const root = items.find((i) => i.sourceDocId === rootDocId)!;
  seen.add(root.sourceDocId);
  result.push(root);
  visit(root.sourceDocId);
  // Also drain rows that named a null parent but aren't the root (belt-and-braces).
  visit(" root");

  for (const it of items) {
    if (!seen.has(it.sourceDocId)) {
      seen.add(it.sourceDocId);
      result.push(it);
    }
  }
  return result;
}

function toJobSummary(job: MigrationJob): JobSummaryView {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    scopeId: job.scopeId,
    sourceRootDocId: job.sourceRootDocId,
    status: job.status,
    totalItems: job.totalItems,
    succeededItems: job.succeededItems,
    failedItems: job.failedItems,
    skippedItems: job.skippedItems,
    error: job.error,
    createdById: job.createdById,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function toMappingView(mapping: MigrationMapping): MappingView {
  return {
    sourceDocId: mapping.sourceDocId,
    codaPageId: mapping.codaPageId,
    codaPageUrl: mapping.codaPageUrl,
    migratedSeq: mapping.migratedSeq,
    lastMigratedAt: mapping.lastMigratedAt,
  };
}

function toJobItem(item: MigrationJobItem): JobItemView {
  return {
    id: item.id,
    sourceDocId: item.sourceDocId,
    plannedParentDocId: item.plannedParentDocId,
    title: item.title,
    targetCodaPageId: item.targetCodaPageId,
    override: item.override,
    codaPageId: item.codaPageId,
    migratedSeq: item.migratedSeq,
    status: item.status,
    attempts: item.attempts,
    lastError: item.lastError,
    seq: item.seq,
  };
}
