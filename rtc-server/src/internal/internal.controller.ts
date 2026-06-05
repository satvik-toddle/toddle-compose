import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InternalTokenGuard } from "./internal-token.guard";
import { DocRepository } from "../persistence/doc-repository.service";
import { DocStateService } from "../persistence/doc-state.service";
import { VersionsService } from "../history/versions.service";
import { SessionsService } from "../history/sessions.service";
import { CompactionService } from "../compaction/compaction.service";

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
    private readonly compaction: CompactionService
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

  @Get(":docId/versions")
  async listVersions(
    @Param("docId") docId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("clientSub") clientSub?: string
  ) {
    const fromN = Math.max(1, Number(from ?? 1));
    const lim = Math.max(1, Math.min(5000, Number(limit ?? 1000)));
    const head = await this.repo.getHeadSeq(docId);
    const toN = to ? Number(to) : head;
    const cs = clientSub && clientSub.length > 0 ? clientSub : null;
    const rows = await this.repo.listDocUpdates(docId, fromN, toN, lim, cs);
    return { docId, head, count: rows.length, clientSub: cs, updates: rows };
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
      gapMs: gapMs ? Number(gapMs) : undefined,
      includeNoop: includeNoop === "true" || includeNoop === "1",
    });
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
