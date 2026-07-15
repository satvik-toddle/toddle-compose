import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { docs as ywsDocs } from "y-websocket/bin/utils";
import { InternalTokenGuard } from "./internal-token.guard";
import { DocRepository } from "../persistence/doc-repository.service";
import { DocStateService } from "../persistence/doc-state.service";
import { VersionsService } from "../history/versions.service";
import { SessionsService } from "../history/sessions.service";
import { CompactionService } from "../compaction/compaction.service";
import { DocKickService } from "../yjs/doc-kick.service";

// Parse an optional integer query param; 400 (not a Prisma 500) on garbage like ?to=abc.
function qInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${name} must be a number`);
  }
  return Math.trunc(n);
}

// Build a ~120-char search-result snippet centered on the first case-insensitive match of q.
function makeSnippet(text: string, q: string): string {
  const WINDOW = 120;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) {
    const head = text.slice(0, WINDOW).replace(/\s+/g, " ").trim();
    return head.length < text.trim().length ? `${head}…` : head;
  }
  const start = Math.max(0, idx - Math.floor((WINDOW - q.length) / 2));
  const end = Math.min(text.length, start + WINDOW);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { ok: true };
  }
}

@Controller("internal/docs")
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    private readonly repo: DocRepository,
    private readonly docState: DocStateService,
    private readonly versions: VersionsService,
    private readonly sessions: SessionsService,
    private readonly compaction: CompactionService,
    private readonly docKick: DocKickService
  ) {}

  @Post("init")
  async init(@Body() body: { docId?: string }) {
    const docId = body?.docId;
    if (typeof docId !== "string" || !docId) {
      throw new BadRequestException("docId required");
    }
    await this.repo.ensureRtcDoc(docId);
    return { ok: true, docId };
  }

  @Post("search")
  async search(@Body() body: { ids?: string[]; q?: string; limit?: number }) {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x) => typeof x === "string")
      : [];
    const q = typeof body?.q === "string" ? body.q.trim() : "";
    // Cap must stay >= the backend's GATHER (documents.service.ts, currently 300) or
    // content matches past the clamp silently vanish from search results and totals.
    const limit = Math.max(1, Math.min(500, Number(body?.limit) || 30));
    if (ids.length === 0 || q === "") return { matches: [] };
    const rows = await this.repo.searchContent(ids, q, limit);
    return {
      matches: rows.map((r) => ({
        docId: r.id,
        snippet: makeSnippet(r.contentText, q),
      })),
    };
  }

  @Get(":docId/versions")
  async listVersions(
    @Param("docId") docId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("clientSub") clientSub?: string
  ) {
    const fromN = Math.max(1, qInt("from", from, 1));
    const lim = Math.max(1, Math.min(5000, qInt("limit", limit, 1000)));
    const head = await this.repo.getHeadSeq(docId);
    const toN = qInt("to", to, head);
    const cs = clientSub && clientSub.length > 0 ? clientSub : null;
    const rows = await this.repo.listDocUpdates(docId, fromN, toN, lim, cs);
    return { docId, head, count: rows.length, clientSub: cs, updates: rows };
  }

  // Read-only current-content projection at head, for the search modal's preview pane.
  @Get(":docId/content")
  async content(@Param("docId") docId: string) {
    const head = await this.repo.getHeadSeq(docId);
    return this.versions.previewAtSeq(docId, head);
  }

  @Get(":docId/versions/:seq")
  async preview(@Param("docId") docId: string, @Param("seq") seq: string) {
    const n = Number(seq);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException("seq must be a non-negative integer");
    }
    return this.versions.previewAtSeq(docId, n);
  }

  @Get(":docId/sessions")
  sessionsList(
    @Param("docId") docId: string,
    @Query("clientSub") clientSub?: string,
    @Query("gapMs") gapMs?: string,
    @Query("includeNoop") includeNoop?: string
  ) {
    const cs = clientSub && clientSub.length > 0 ? clientSub : null;
    return this.sessions.buildSessions(docId, {
      clientSub: cs,
      gapMs: gapMs ? qInt("gapMs", gapMs, 0) : undefined,
      includeNoop: includeNoop === "true" || includeNoop === "1",
    });
  }

  @Delete(":docId")
  async deleteDoc(@Param("docId") docId: string) {
    // Tear down any live doc without flushing; clear `conns` before closing so closeConn doesn't re-persist via writeState.
    const liveDoc = ywsDocs.get(docId);
    if (liveDoc) {
      const conns = [...liveDoc.conns.keys()];
      liveDoc.conns.clear();
      ywsDocs.delete(docId);
      for (const conn of conns) {
        try {
          conn.close(1008, "document deleted");
        } catch {
          /* already closed */
        }
      }
      liveDoc.destroy();
    }
    // Drop in-memory persistence state (timers, debounce, append chain).
    await this.docState.evictDocNoFlush(docId);
    // Atomically delete the doc and its update rows; idempotent.
    await this.repo.deleteDocCompletely(docId);
    return { ok: true, docId };
  }

  // Force-refresh access: close all live sockets on the doc and invalidate already-minted tokens.
  // kickedAt (optional, epoch seconds from the backend clock) becomes the revocation watermark.
  @Post(":docId/kick")
  kick(@Param("docId") docId: string, @Body() body?: { kickedAt?: number }) {
    const closed = this.docKick.kickDoc(docId, body?.kickedAt);
    return { ok: true, docId, closed };
  }

  @Post(":docId/compact-demo")
  async compactDemo(
    @Param("docId") docId: string,
    @Query("tier") tier?: string
  ) {
    if (tier !== "1" && tier !== "2") {
      throw new BadRequestException("tier must be '1' or '2'");
    }
    const ckpt = await this.docState.forceCheckpoint(
      docId,
      `compact-demo-tier${tier}`
    );
    if (!ckpt) {
      throw new ConflictException(
        "doc is not warm — open it in the editor first"
      );
    }
    const stats = await this.compaction.forceCompactionForDoc(docId, {
      tier1: tier === "1",
      tier2: tier === "2",
    });
    return { docId, tier, stats };
  }
}
