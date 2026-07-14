import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { SheetSnapshot, extractSheet } from "../persistence/searchable-text";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import { createLogger } from "../logger";

const log = createLogger("sessions");
const DEFAULT_GAP_MS = 30_000;

export type ChangedCell = { rowId: string; colId: string };

export type Session = {
  firstSeq: number;
  lastSeq: number;
  clientSub: string | null;
  startedAt: number;
  endedAt: number;
  updateCount: number;
  totalBytes: number;
  noop: boolean;
  beforeText: string;
  afterText: string;
  origin: string | null;
  // SHEET docs only: cells changed this session (for UI highlight); empty for DOC.
  changedCells: ChangedCell[];
};

// undefined and null collapse to the same "empty" so a blank cell isn't reported as a change.
const cellRepr = (v: unknown) => JSON.stringify(v === undefined ? null : v);

// Cells differing between two sheet states; rows removed in `after` are ignored (nothing to highlight).
function diffSheetCells(
  before: SheetSnapshot | null,
  after: SheetSnapshot | null
): ChangedCell[] {
  if (!after) return [];
  const prevByRow = new Map<string, Record<string, unknown>>();
  if (before) {
    for (const r of before.rows) if (r.rowId) prevByRow.set(r.rowId, r.values);
  }
  const changed: ChangedCell[] = [];
  for (const r of after.rows) {
    if (!r.rowId) continue;
    const prev = prevByRow.get(r.rowId);
    const colIds = new Set<string>([
      ...Object.keys(r.values),
      ...(prev ? Object.keys(prev) : []),
    ]);
    for (const colId of colIds) {
      const a = r.values[colId];
      const b = prev ? prev[colId] : undefined;
      if (cellRepr(a) !== cellRepr(b)) changed.push({ rowId: r.rowId, colId });
    }
  }
  return changed;
}

export type SessionList = {
  docId: string;
  head: number;
  gapMs: number;
  clientSub: string | null;
  totalSessions: number;
  filteredCount: number;
  sessions: Session[];
};

@Injectable()
export class SessionsService {
  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService
  ) {}

  async buildSessions(
    docId: string,
    opts: { clientSub?: string | null; gapMs?: number; includeNoop?: boolean } = {}
  ): Promise<SessionList> {
    const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    const clientSub = opts.clientSub ?? null;
    const includeNoop = opts.includeNoop ?? false;
    const head = await this.repo.getHeadSeq(docId);
    const all = await this.repo.listDocUpdates(docId, 1, head, 100000, clientSub);

    const groups: Array<{
      firstSeq: number;
      lastSeq: number;
      clientSub: string | null;
      startedAt: number;
      endedAt: number;
      updateCount: number;
      totalBytes: number;
      origin: string | null;
    }> = [];

    for (const u of all) {
      const last = groups[groups.length - 1];
      const isArchive = u.origin === "archive";
      const sameSub = last && last.clientSub === u.client_sub;
      const withinGap = last && u.created_at - last.endedAt <= gapMs;
      const sameKind = last && (last.origin === "archive") === isArchive;
      if (last && sameSub && withinGap && sameKind && !isArchive) {
        last.lastSeq = u.seq;
        last.endedAt = u.created_at;
        last.updateCount += 1;
        last.totalBytes += u.byte_len;
      } else {
        groups.push({
          firstSeq: u.seq,
          lastSeq: u.seq,
          clientSub: u.client_sub,
          startedAt: u.created_at,
          endedAt: u.created_at,
          updateCount: 1,
          totalBytes: u.byte_len,
          origin: u.origin,
        });
      }
    }

    // Single-pass O(N) replay snapshotting every boundary, not replaying from seq 1 per boundary.
    const atBoundary = await this.replayBoundaries(
      await this.repo.getDocUpdateBlobsUpTo(docId, head),
      [...new Set(groups.flatMap((g) => [g.firstSeq - 1, g.lastSeq]))].sort(
        (a, b) => a - b
      )
    );

    const sessions: Session[] = [];
    for (const g of groups) {
      const before = atBoundary.get(g.firstSeq - 1);
      const after = atBoundary.get(g.lastSeq);
      const beforeText = before?.text ?? "";
      const afterText = after?.text ?? "";
      const noop = beforeText === afterText;
      const changedCells = diffSheetCells(
        before?.sheet ?? null,
        after?.sheet ?? null
      );
      sessions.push({ ...g, noop, beforeText, afterText, changedCells });
    }

    const filtered = includeNoop
      ? sessions
      : sessions.filter((s) => !s.noop || s.origin === "archive");
    log.info(
      `'${docId}' sessions: ${groups.length} total, ${filtered.length} after noop filter`
    );

    return {
      docId,
      head,
      gapMs,
      clientSub,
      totalSessions: groups.length,
      filteredCount: filtered.length,
      sessions: filtered,
    };
  }

  // Single-pass equivalent of previewAtSeq per boundary; for SHEET docs `text` is the grid's canonical serialization (so cell changes aren't seen as no-ops).
  private async replayBoundaries(
    blobs: { seq: number; blob: Buffer }[],
    boundaries: number[]
  ): Promise<Map<number, { text: string; sheet: SheetSnapshot | null }>> {
    type Snap = { text: string; sheet: SheetSnapshot | null };
    const at = new Map<number, Snap>();
    if (boundaries.length === 0) return at;
    const ydoc = new Y.Doc();
    let last: Snap = { text: "", sheet: null };
    let dirty = true;
    const capture = async (): Promise<Snap> => {
      if (dirty) {
        // Read the grid off the live doc before worker extraction (see previewAtSeq).
        const sheet = extractSheet(ydoc);
        const { plainText } = await this.extract.extractFromBytes(
          Y.encodeStateAsUpdate(ydoc)
        );
        const text = sheet
          ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
          : plainText;
        last = { text, sheet };
        dirty = false;
      }
      return last;
    };
    let bi = 0;
    for (const { seq, blob } of blobs) {
      while (bi < boundaries.length && boundaries[bi] < seq) {
        at.set(boundaries[bi], await capture());
        bi += 1;
      }
      if (bi >= boundaries.length) break;
      Y.applyUpdate(ydoc, new Uint8Array(blob));
      dirty = true;
    }
    while (bi < boundaries.length) {
      at.set(boundaries[bi], await capture());
      bi += 1;
    }
    return at;
  }
}
