import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CodaImportJob, CodaImportJobItem } from "@app/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { CodaClient } from "../coda/coda.client";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { NON_TERMINAL_JOB_STATUSES } from "../migration/job-status";
import { resolveTarget } from "../migration/coda-resolve";
import { CodaImportCredentialsService } from "./coda-import-credentials.service";
import { CodaImportWorkerClient } from "./coda-import-worker.client";
import { EnqueueCodaImportJobDto } from "./dto";

// Result of the modal's Validate step — what the admin confirms before enqueue.
// rootName is the default workspace name: the doc name for a whole-doc import, the
// page name for a page-subtree import. codaRootPageId is null for a whole-doc import,
// set when the URL targets a page (import only that page's descendants). pageCount is
// the number of DOCS the import will create (all pages for a doc; the descendant count
// for a page — the root page itself is a folder, not a doc).
interface ValidateResult {
  codaDocId: string;
  codaRootPageId: string | null;
  rootName: string;
  pageCount: number;
  canonicalUrl: string;
}

// Job summary for the org-wide listing — never exposes worker lease internals.
interface JobSummaryView {
  id: string;
  codaDocId: string;
  codaDocUrl: string;
  targetWorkspaceName: string;
  targetWorkspaceId: string | null;
  status: CodaImportJob["status"];
  totalItems: number;
  succeededItems: number;
  failedItems: number;
  skippedItems: number;
  // Live worker activity line while non-terminal; null when finished.
  progressMessage: string | null;
  // False while the worker is still listing/creating items (whole-doc imports plan
  // incrementally); true once every page has an item — the UI shows a "fetching more"
  // row until then.
  planningComplete: boolean;
  createdById: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// Per-item execution state — omits the worker lease (leasedBy/leasedUntil).
interface JobItemView {
  id: string;
  codaPageId: string;
  codaPageName: string;
  plannedParentCodaPageId: string | null;
  createdDocId: string | null;
  status: CodaImportJobItem["status"];
  attempts: number;
  lastError: string | null;
  seq: number;
}

// "Import from Coda" job lifecycle (Phase 6): validate a Coda URL for the modal,
// then enqueue a QUEUED job the Phase 7 worker executes. Every endpoint is
// realm-admin gated (MAINTAINER+) — imports create a brand-new workspace and run
// against the global, unscoped token pool. The heavy work (listing pages, creating
// docs, writing content) is the WORKER's job; enqueue only resolves the doc id,
// creates the target workspace + job row, and wakes the worker.
@Injectable()
export class CodaImportJobsService {
  private readonly log = new Logger("CodaImportJobs");

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly coda: CodaClient,
    private readonly workspaces: WorkspacesService,
    private readonly credentials: CodaImportCredentialsService,
    private readonly worker: CodaImportWorkerClient,
  ) {}

  // GET /admin/coda-import/validate?url= — resolve the URL to its import ROOT, then
  // read the default workspace name + how many docs will be created, for the modal.
  //   - A page URL: the page is the workspace container (a folder). rootName = the
  //     page name; pageCount = the page's DESCENDANT count (the docs to create — the
  //     root page itself is not a doc); codaRootPageId = the page id.
  //   - A doc URL: the whole doc is the workspace. rootName = the doc name; pageCount
  //     = every page; codaRootPageId = null.
  // Bad/unreachable URLs surface as 400 (resolveTarget throws BadRequest; Coda read
  // errors mapped) — but the underlying reason is preserved so failures are debuggable.
  async validate(
    userId: string,
    url: string,
    credentialId: string,
  ): Promise<ValidateResult> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    if (!url) throw new BadRequestException("url is required");
    if (!credentialId) throw new BadRequestException("credentialId is required");

    // Single-token pool: only the admin-picked credential is used (getToken throws
    // NotFound if it was deleted). CodaClient accepts a string[] pool.
    const pool = [await this.credentials.getToken(credentialId)];

    const { docId, pageId, canonicalUrl } = await resolveTarget(
      this.coda,
      pool,
      url,
    );

    try {
      const pages = await this.coda.listPages(pool, docId);
      if (pageId) {
        // Page-subtree import: name from the page (fall back to a direct fetch if the
        // listing didn't carry it), count = the root page itself + its descendants
        // (the docs we'll create — the root page IS imported as a top-level doc).
        const inList = pages.find((p) => p.id === pageId);
        const rootName =
          inList?.name ?? (await this.coda.getPage(pool, docId, pageId)).name;
        return {
          codaDocId: docId,
          codaRootPageId: pageId,
          rootName: rootName || "Untitled",
          pageCount: countDescendants(pages, pageId) + 1,
          canonicalUrl,
        };
      }
      // Whole-doc import: name from the doc, count = every page.
      const doc = await this.coda.getDoc(pool, docId);
      return {
        codaDocId: docId,
        codaRootPageId: null,
        rootName: doc.name ?? "Untitled",
        pageCount: pages.length,
        canonicalUrl,
      };
    } catch (e) {
      // Don't swallow the reason — a bare "could not read" once hid a real bug.
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`validate: reading Coda from ${url} failed: ${reason}`);
      throw new BadRequestException(
        `could not read Coda doc from URL: ${url} (${reason})`,
      );
    }
  }

  // POST /admin/coda-import/jobs — create the target workspace + a QUEUED job, then
  // wake the worker. Lightweight: re-resolves the docId server-side (never trusts a
  // client value) but does NOT list pages — the worker plans the job (creates items)
  // when it claims the run.
  async enqueue(
    userId: string,
    dto: EnqueueCodaImportJobDto,
  ): Promise<{ jobId: string; workspaceId: string; status: CodaImportJob["status"] }> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");

    // Pin the job to the admin-picked credential; getToken throws NotFound if it was
    // deleted between validate and enqueue. Only this token is used for the import.
    const pool = [await this.credentials.getToken(dto.credentialId)];

    // Re-resolve from the URL so the persisted docId + root page can't be spoofed by
    // the client. A page URL → codaRootPageId set (import only that page's subtree);
    // a doc URL → null (whole-doc import).
    const { docId, pageId, canonicalUrl } = await resolveTarget(
      this.coda,
      pool,
      dto.codaDocUrl,
    );

    const workspace = await this.workspaces.create(userId, {
      name: dto.workspaceName,
    });

    const job = await this.prisma.codaImportJob.create({
      data: {
        codaDocId: docId,
        codaRootPageId: pageId,
        codaDocUrl: canonicalUrl,
        credentialId: dto.credentialId,
        targetWorkspaceName: dto.workspaceName,
        targetWorkspaceId: workspace.id,
        createdById: userId,
        status: "QUEUED",
        totalItems: 0,
      },
      select: { id: true, status: true },
    });

    // First milestone on the durable activity timeline (separate row → race-free).
    await this.prisma.codaImportJobEvent.create({
      data: { jobId: job.id, message: `Workspace "${dto.workspaceName}" created` },
    });

    this.log.log(
      `[import job=${job.id}] enqueued codaDoc=${docId} → workspace=${workspace.id} by=${userId}`,
    );

    // Fire-and-forget: a down/unconfigured worker must not fail the enqueue.
    void this.worker.ping();

    return { jobId: job.id, workspaceId: workspace.id, status: job.status };
  }

  // GET /admin/coda-import/jobs — org-wide listing, newest first. Summaries only.
  async list(userId: string): Promise<JobSummaryView[]> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const jobs = await this.prisma.codaImportJob.findMany({
      orderBy: { createdAt: "desc" },
    });
    return jobs.map(toJobSummary);
  }

  // GET /admin/coda-import/jobs/:id — one job with its items (by seq) and its ordered
  // milestone timeline (events, oldest first).
  async get(
    userId: string,
    id: string,
  ): Promise<
    JobSummaryView & {
      items: JobItemView[];
      events: { message: string; createdAt: Date }[];
    }
  > {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const job = await this.prisma.codaImportJob.findUnique({
      where: { id },
      include: {
        items: { orderBy: { seq: "asc" } },
        events: {
          orderBy: { createdAt: "asc" },
          select: { message: true, createdAt: true },
        },
      },
    });
    if (!job) throw new NotFoundException("coda import job not found");
    return {
      ...toJobSummary(job),
      items: job.items.map(toJobItem),
      events: job.events,
    };
  }

  // POST /admin/coda-import/jobs/:id/cancel — stop a run: job → CANCELED. Guarded on
  // QUEUED/RUNNING so only a non-terminal job flips (a concurrent finalize/cancel is
  // never clobbered); the worker re-checks status before each item and stops planning
  // between page batches, so in-flight work winds down on its own. 404 when the job is
  // gone, 409 when it is already terminal (nothing to cancel).
  async cancel(userId: string, id: string): Promise<JobSummaryView> {
    await this.authz.requireRealmRole(userId, "MAINTAINER");
    const existing = await this.prisma.codaImportJob.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("coda import job not found");
    const res = await this.prisma.codaImportJob.updateMany({
      where: { id, status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
      data: { status: "CANCELED", finishedAt: new Date(), progressMessage: null },
    });
    if (res.count === 0) {
      throw new ConflictException("only a queued or running import can be canceled");
    }
    await this.prisma.codaImportJobEvent.create({
      data: { jobId: id, message: "Import canceled" },
    });
    const updated = await this.prisma.codaImportJob.findUniqueOrThrow({ where: { id } });
    return toJobSummary(updated);
  }
}

// Count the pages transitively under rootPageId (its descendants) from the flat page
// list, keyed on each page's parent ref — the number of docs a page-subtree import
// creates (the root page itself is a folder, not a doc, so it's excluded). Visited-
// guarded so a malformed parent cycle can't loop.
function countDescendants(
  pages: { id: string; parent?: { id?: string } | null }[],
  rootPageId: string,
): number {
  const childrenByParentId = new Map<string, string[]>();
  for (const p of pages) {
    const parentId = p.parent?.id;
    if (!parentId) continue;
    const bucket = childrenByParentId.get(parentId) ?? [];
    bucket.push(p.id);
    childrenByParentId.set(parentId, bucket);
  }
  let count = 0;
  const seen = new Set<string>();
  const stack = [...(childrenByParentId.get(rootPageId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    count++;
    stack.push(...(childrenByParentId.get(id) ?? []));
  }
  return count;
}

function toJobSummary(job: CodaImportJob): JobSummaryView {
  return {
    id: job.id,
    codaDocId: job.codaDocId,
    codaDocUrl: job.codaDocUrl,
    targetWorkspaceName: job.targetWorkspaceName,
    targetWorkspaceId: job.targetWorkspaceId,
    status: job.status,
    totalItems: job.totalItems,
    succeededItems: job.succeededItems,
    failedItems: job.failedItems,
    skippedItems: job.skippedItems,
    progressMessage: job.progressMessage,
    planningComplete: job.planningComplete,
    createdById: job.createdById,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function toJobItem(item: CodaImportJobItem): JobItemView {
  return {
    id: item.id,
    codaPageId: item.codaPageId,
    codaPageName: item.codaPageName,
    plannedParentCodaPageId: item.plannedParentCodaPageId,
    createdDocId: item.createdDocId,
    status: item.status,
    attempts: item.attempts,
    lastError: item.lastError,
    seq: item.seq,
  };
}
