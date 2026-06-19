import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Y from "yjs";
import {
  DocRepository,
  type CompactionCandidate,
} from "../persistence/doc-repository.service";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("compact");

export type CompactionStats = {
  tier1RowsBefore: number;
  tier1RowsAfter: number;
  tier1SessionsMerged: number;
  tier2RowsBefore: number;
  tier2RowsAfter: number;
  tier2Merged: boolean;
  errors: number;
};

type SessionGroup = { clientSub: string | null; rows: CompactionCandidate[] };

function emptyStats(): CompactionStats {
  return {
    tier1RowsBefore: 0,
    tier1RowsAfter: 0,
    tier1SessionsMerged: 0,
    tier2RowsBefore: 0,
    tier2RowsAfter: 0,
    tier2Merged: false,
    errors: 0,
  };
}

@Injectable()
export class CompactionService {
  constructor(
    private readonly repo: DocRepository,
    private readonly config: ConfigService<Env, true>
  ) {}

  private env<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  private groupBySession(
    rows: CompactionCandidate[],
    gapMs: number
  ): SessionGroup[] {
    const groups: SessionGroup[] = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      const sameSub = last && last.clientSub === r.client_sub;
      const withinGap =
        last &&
        r.created_at - last.rows[last.rows.length - 1].created_at <= gapMs;
      if (last && sameSub && withinGap) {
        last.rows.push(r);
      } else {
        groups.push({ clientSub: r.client_sub, rows: [r] });
      }
    }
    return groups;
  }

  private mergeBlobs(blobs: Buffer[]): Buffer {
    const ydoc = new Y.Doc();
    for (const b of blobs) Y.applyUpdate(ydoc, new Uint8Array(b));
    return Buffer.from(Y.encodeStateAsUpdate(ydoc));
  }

  private async runTier1(
    docId: string,
    snapshotAtSeq: number,
    cutoff: number,
    stats: CompactionStats
  ): Promise<void> {
    if (cutoff <= 0) return;
    const candidates = await this.repo.listTier1Candidates(
      docId,
      snapshotAtSeq,
      cutoff
    );
    stats.tier1RowsBefore += candidates.length;
    if (candidates.length === 0) return;
    const groups = this.groupBySession(candidates, this.env("RTC_SESSION_GAP_MS"));
    for (const g of groups) {
      if (g.rows.length < 2) {
        stats.tier1RowsAfter += 1;
        continue;
      }
      const minSeq = g.rows[0].seq;
      const maxSeq = g.rows[g.rows.length - 1].seq;
      const maxCreatedAt = g.rows[g.rows.length - 1].created_at;
      try {
        const merged = this.mergeBlobs(g.rows.map((r) => r.blob));
        await this.repo.replaceSeqRangeWithMerged({
          docId,
          minSeq,
          maxSeq,
          mergedSeq: maxSeq,
          mergedBlob: merged,
          origin: "session-compacted",
          clientSub: g.clientSub,
          createdAt: maxCreatedAt,
        });
        stats.tier1SessionsMerged += 1;
        stats.tier1RowsAfter += 1;
      } catch (e) {
        stats.errors += 1;
        log.error(`'${docId}' tier1 FAILED seq=${minSeq}..${maxSeq}`, e);
      }
    }
  }

  private async runTier2(
    docId: string,
    snapshotAtSeq: number,
    cutoff: number,
    stats: CompactionStats
  ): Promise<void> {
    if (cutoff <= 0) return;
    const candidates = await this.repo.listTier2Candidates(
      docId,
      snapshotAtSeq,
      cutoff
    );
    stats.tier2RowsBefore += candidates.length;
    if (candidates.length === 0) return;
    if (candidates.length === 1 && candidates[0].origin === "archive") {
      stats.tier2RowsAfter = 1;
      return;
    }
    const minSeq = candidates[0].seq;
    const maxSeq = candidates[candidates.length - 1].seq;
    const maxCreatedAt = candidates[candidates.length - 1].created_at;
    try {
      const merged = this.mergeBlobs(candidates.map((c) => c.blob));
      await this.repo.replaceSeqRangeWithMerged({
        docId,
        minSeq,
        maxSeq,
        mergedSeq: maxSeq,
        mergedBlob: merged,
        origin: "archive",
        clientSub: null,
        createdAt: maxCreatedAt,
      });
      stats.tier2Merged = true;
      stats.tier2RowsAfter = 1;
      log.debug(
        `'${docId}' tier2 archive: ${candidates.length} rows → 1 at seq=${maxSeq}`
      );
    } catch (e) {
      stats.errors += 1;
      log.error(`'${docId}' tier2 FAILED seq=${minSeq}..${maxSeq}`, e);
    }
  }

  async runCompactionForDoc(docId: string): Promise<CompactionStats> {
    const stats = emptyStats();
    const row = await this.repo.getRtcDoc(docId);
    const snapshotAtSeq = row?.snapshotAtSeq ?? 0;
    if (snapshotAtSeq === 0) return stats;
    const now = Date.now();
    await this.runTier1(docId, snapshotAtSeq, now - this.env("RTC_TIER1_AGE_MS"), stats);
    await this.runTier2(docId, snapshotAtSeq, now - this.env("RTC_TIER2_AGE_MS"), stats);
    if (stats.tier1SessionsMerged > 0 || stats.tier2Merged || stats.errors > 0) {
      log.debug(
        `'${docId}' compaction: t1=${stats.tier1SessionsMerged} t2=${stats.tier2Merged} errors=${stats.errors}`
      );
    }
    return stats;
  }

  async forceCompactionForDoc(
    docId: string,
    opts: { tier1?: boolean; tier2?: boolean }
  ): Promise<CompactionStats> {
    const stats = emptyStats();
    const row = await this.repo.getRtcDoc(docId);
    const snapshotAtSeq = row?.snapshotAtSeq ?? 0;
    if (snapshotAtSeq === 0) {
      log.warn(`'${docId}' forceCompaction skipped: snapshot_at_seq=0`);
      return stats;
    }
    const cutoff = Date.now() + 60 * 60 * 1000;
    if (opts.tier1) await this.runTier1(docId, snapshotAtSeq, cutoff, stats);
    if (opts.tier2) await this.runTier2(docId, snapshotAtSeq, cutoff, stats);
    log.debug(
      `'${docId}' FORCED compaction tier1=${!!opts.tier1} tier2=${!!opts.tier2} t1=${stats.tier1SessionsMerged} t2=${stats.tier2Merged}`
    );
    return stats;
  }

  async runCompactionPass(): Promise<void> {
    const t0 = Date.now();
    const docIds = await this.repo.listDocIdsWithUpdates();
    let totalT1 = 0;
    let totalT2 = 0;
    for (const id of docIds) {
      try {
        const s = await this.runCompactionForDoc(id);
        totalT1 += s.tier1SessionsMerged;
        if (s.tier2Merged) totalT2 += 1;
      } catch (e) {
        log.error(`'${id}' uncaught in compaction`, e);
      }
    }
    log.info(
      `compaction pass done in ${Date.now() - t0}ms: ${totalT1} merged, ${totalT2} archived across ${docIds.length} docs`
    );
  }
}
