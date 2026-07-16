import { Injectable } from "@nestjs/common";
import { Prisma } from "@app/rtc-database";
import { PrismaService } from "../prisma/prisma.service";
import { createLogger } from "../logger";

const log = createLogger("db");

// Prisma 7 types Bytes columns as Uint8Array<ArrayBuffer>. Node Buffers are
// valid Bytes inputs at runtime (a Buffer is a Uint8Array backed by a regular,
// non-shared ArrayBuffer), but @types/node now widens Buffer's backing store to
// ArrayBufferLike, which no longer matches structurally. Narrow it back at the
// Prisma write boundary — zero-copy, no allocation.
const asBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> =>
  b as Uint8Array<ArrayBuffer>;

export type RtcUpdateRow = {
  seq: number;
  byte_len: number;
  origin: string | null;
  client_sub: string | null;
  created_at: number;
};

export type CompactionCandidate = {
  seq: number;
  blob: Buffer;
  origin: string | null;
  client_sub: string | null;
  created_at: number;
};

@Injectable()
export class DocRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureRtcDoc(id: string): Promise<void> {
    await this.prisma.rtcDocument.upsert({
      where: { id },
      create: {
        id,
        version: 0,
        updatedAt: BigInt(Date.now()),
        snapshotAtSeq: 0,
      },
      update: {},
    });
  }

  getRtcDoc(id: string) {
    return this.prisma.rtcDocument.findUnique({ where: { id } });
  }

  async persistRtcDoc(
    id: string,
    yjsState: Buffer,
    snapshotAtSeq: number
  ): Promise<number> {
    await this.ensureRtcDoc(id);
    // Snapshot write + stale-queue enqueue in ONE tx (G1): if the snapshot is durable, so is
    // the fact that the search index is behind — nothing can leave the index permanently stale.
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.rtcDocument.update({
        where: { id },
        data: {
          yjsState: asBytes(yjsState),
          snapshotAtSeq,
          version: { increment: 1 },
          updatedAt: BigInt(Date.now()),
        },
      });
      await this.enqueueStale(tx, id, snapshotAtSeq);
      return row.version;
    });
  }

  async writeSnapshotCheckpoint(
    id: string,
    yjsState: Buffer,
    snapshotAtSeq: number
  ): Promise<void> {
    await this.ensureRtcDoc(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.rtcDocument.update({
        where: { id },
        data: {
          yjsState: asBytes(yjsState),
          snapshotAtSeq,
          updatedAt: BigInt(Date.now()),
        },
      });
      await this.enqueueStale(tx, id, snapshotAtSeq);
    });
  }

  // Coalescing enqueue: PK doc_id, overwrite seq with the newer flush seq (monotonic).
  private enqueueStale(
    tx: Prisma.TransactionClient,
    docId: string,
    seq: number
  ): Promise<unknown> {
    const dirtyAt = BigInt(Date.now());
    return tx.staleDocument.upsert({
      where: { docId },
      create: { docId, seq, dirtyAt },
      update: { seq, dirtyAt },
    });
  }

  // ---- Search indexer worker: drain the stale queue ----

  // Oldest-first claim; lock-free (G2/G3 make duplicated work harmless, so no FOR UPDATE).
  async claimStale(take: number): Promise<{ docId: string; seq: number }[]> {
    return this.prisma.staleDocument.findMany({
      orderBy: { dirtyAt: "asc" },
      take,
      select: { docId: true, seq: true },
    });
  }

  async getRtcStatesForIndex(
    ids: string[]
  ): Promise<{ id: string; yjsState: Uint8Array | null }[]> {
    return this.prisma.rtcDocument.findMany({
      where: { id: { in: ids } },
      select: { id: true, yjsState: true },
    });
  }

  // Guarded delete (G2): clears the row only if no newer flush has bumped its seq since we
  // claimed it; a concurrent re-flush (seq > claimed) leaves the row for the next sweep.
  async deleteStaleUpTo(docId: string, seq: number): Promise<void> {
    await this.prisma.staleDocument.deleteMany({
      where: { docId, seq: { lte: seq } },
    });
  }

  async countStale(): Promise<number> {
    return this.prisma.staleDocument.count();
  }

  async oldestStaleDirtyAt(): Promise<number | null> {
    const row = await this.prisma.staleDocument.findFirst({
      orderBy: { dirtyAt: "asc" },
      select: { dirtyAt: true },
    });
    return row ? Number(row.dirtyAt) : null;
  }

  // Single-writer-per-doc: seq = max(seq)+1 in a tx — racy if horizontally scaled without doc-to-instance affinity.
  async appendDocUpdate(
    docId: string,
    blob: Buffer,
    origin: string | null,
    clientSub: string | null
  ): Promise<number> {
    const seq = await this.prisma.$transaction(async (tx) => {
      const agg = await tx.rtcDocumentUpdate.aggregate({
        where: { docId },
        _max: { seq: true },
      });
      const next = (agg._max.seq ?? 0) + 1;
      await tx.rtcDocumentUpdate.create({
        data: {
          docId,
          seq: next,
          updateBlob: asBytes(blob),
          byteLen: blob.byteLength,
          origin,
          clientSub,
          createdAt: BigInt(Date.now()),
        },
      });
      return next;
    });
    log.debug(
      `appendDocUpdate '${docId}' seq=${seq} ${blob.byteLength}B origin=${origin ?? "-"} client=${clientSub ?? "-"}`
    );
    return seq;
  }

  async getHeadSeq(docId: string): Promise<number> {
    const agg = await this.prisma.rtcDocumentUpdate.aggregate({
      where: { docId },
      _max: { seq: true },
    });
    return agg._max.seq ?? 0;
  }

  async getDocUpdateBlobsAfterSeq(
    docId: string,
    afterSeq: number
  ): Promise<{ seq: number; blob: Buffer }[]> {
    const rows = await this.prisma.rtcDocumentUpdate.findMany({
      where: { docId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
      select: { seq: true, updateBlob: true },
    });
    return rows.map((r) => ({ seq: r.seq, blob: Buffer.from(r.updateBlob) }));
  }

  async getDocUpdateBlobsUpTo(
    docId: string,
    maxSeq: number
  ): Promise<{ seq: number; blob: Buffer }[]> {
    const rows = await this.prisma.rtcDocumentUpdate.findMany({
      where: { docId, seq: { lte: maxSeq } },
      orderBy: { seq: "asc" },
      select: { seq: true, updateBlob: true },
    });
    return rows.map((r) => ({ seq: r.seq, blob: Buffer.from(r.updateBlob) }));
  }

  async listDocIdsWithUpdates(): Promise<string[]> {
    const rows = await this.prisma.rtcDocumentUpdate.findMany({
      distinct: ["docId"],
      select: { docId: true },
    });
    return rows.map((r) => r.docId);
  }

  async listDocUpdates(
    docId: string,
    from: number,
    to: number,
    limit: number,
    clientSub: string | null = null
  ): Promise<RtcUpdateRow[]> {
    const rows = await this.prisma.rtcDocumentUpdate.findMany({
      where: {
        docId,
        seq: { gte: from, lte: to },
        ...(clientSub ? { clientSub } : {}),
      },
      orderBy: { seq: "asc" },
      take: limit,
      select: {
        seq: true,
        byteLen: true,
        origin: true,
        clientSub: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      seq: r.seq,
      byte_len: r.byteLen,
      origin: r.origin,
      client_sub: r.clientSub,
      created_at: Number(r.createdAt),
    }));
  }

  private async listCandidates(
    docId: string,
    snapshotAtSeq: number,
    beforeMs: number,
    excludeCompacted: boolean
  ): Promise<CompactionCandidate[]> {
    const rows = await this.prisma.rtcDocumentUpdate.findMany({
      where: {
        docId,
        seq: { lte: snapshotAtSeq },
        createdAt: { lt: BigInt(beforeMs) },
        ...(excludeCompacted
          ? { origin: { notIn: ["session-compacted", "archive"] } }
          : {}),
      },
      orderBy: { seq: "asc" },
      select: {
        seq: true,
        updateBlob: true,
        origin: true,
        clientSub: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      seq: r.seq,
      blob: Buffer.from(r.updateBlob),
      origin: r.origin,
      client_sub: r.clientSub,
      created_at: Number(r.createdAt),
    }));
  }

  listTier1Candidates(docId: string, snapshotAtSeq: number, beforeMs: number) {
    return this.listCandidates(docId, snapshotAtSeq, beforeMs, true);
  }

  listTier2Candidates(docId: string, snapshotAtSeq: number, beforeMs: number) {
    return this.listCandidates(docId, snapshotAtSeq, beforeMs, false);
  }

  /** Delete the doc row and ALL its update rows in one transaction. Idempotent. */
  async deleteDocCompletely(docId: string): Promise<void> {
    const [updates, docsDeleted] = await this.prisma.$transaction([
      this.prisma.rtcDocumentUpdate.deleteMany({ where: { docId } }),
      this.prisma.rtcDocument.deleteMany({ where: { id: docId } }),
    ]);
    log.info(
      `deleteDocCompletely '${docId}' removed doc=${docsDeleted.count} updates=${updates.count}`
    );
  }

  // Deletes exactly the merged rows, not a seq range: non-candidate rows (already-compacted/too-young) can sit between candidate seqs, and a range delete silently dropped them.
  async replaceSeqsWithMerged(args: {
    docId: string;
    seqs: number[];
    mergedSeq: number;
    mergedBlob: Buffer;
    origin: string;
    clientSub: string | null;
    createdAt: number;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const del = await tx.rtcDocumentUpdate.deleteMany({
        where: {
          docId: args.docId,
          seq: { in: args.seqs },
        },
      });
      await tx.rtcDocumentUpdate.create({
        data: {
          docId: args.docId,
          seq: args.mergedSeq,
          updateBlob: asBytes(args.mergedBlob),
          byteLen: args.mergedBlob.byteLength,
          origin: args.origin,
          clientSub: args.clientSub,
          createdAt: BigInt(args.createdAt),
        },
      });
      return del.count;
    });
  }
}
