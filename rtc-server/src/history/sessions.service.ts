import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { VersionsService, SheetSnapshot } from "./versions.service";
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
  // For SHEET docs: the cells whose value changed during this session
  // (added or updated), so the UI can highlight them. Empty for DOC docs.
  changedCells: ChangedCell[];
};

// Normalize a cell value for equality: undefined and null collapse to the same
// "empty" so a freshly-added blank cell isn't reported as a change.
const cellRepr = (v: unknown) => JSON.stringify(v === undefined ? null : v);

/**
 * Cells that differ between two sheet states, keyed by rowId+colId. Covers
 * added rows (everything in them is "changed") and updated cells. Rows removed
 * in `after` can't be highlighted (they're gone) and are ignored.
 */
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
    private readonly extract: LexicalExtractService,
    // Used to reconstruct per-boundary grid snapshots for SHEET changed-cell diffs.
    private readonly versions: VersionsService
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

    // Single-pass replay: instead of calling previewAtSeq per session boundary
    // (each of which replays ALL blobs from seq 1 — O(N²)), load the full blob
    // log once in ascending seq order, apply progressively to ONE Y.Doc, and
    // capture the extracted text at each boundary as we pass it. Boundaries use
    // the UNFILTERED log (same as previewAtSeq), even when groups are filtered
    // by clientSub.
    const textAtBoundary = await this.replayTextAtBoundaries(
      await this.repo.getDocUpdateBlobsUpTo(docId, head),
      [...new Set(groups.flatMap((g) => [g.firstSeq - 1, g.lastSeq]))].sort(
        (a, b) => a - b
      )
    );

    // Only SHEET docs need per-boundary grid snapshots for changed-cell
    // highlighting. Detect kind once (single preview at head) so DOC docs keep
    // develop's O(N) single-pass text replay and skip the extra per-boundary work.
    const isSheet = (await this.versions.previewAtSeq(docId, head)).sheet !== null;

    const sessions: Session[] = [];
    for (const g of groups) {
      // Text/no-op detection uses the single-pass boundary replay (cheap).
      const beforeText = textAtBoundary.get(g.firstSeq - 1) ?? "";
      const afterText = textAtBoundary.get(g.lastSeq) ?? "";
      const noop = beforeText === afterText;

      // SHEET docs: diff the grid snapshots at the boundaries for changed cells.
      let changedCells: ChangedCell[] = [];
      if (isSheet) {
        const before = await this.versions.previewAtSeq(docId, g.firstSeq - 1);
        const after = await this.versions.previewAtSeq(docId, g.lastSeq);
        changedCells = diffSheetCells(before.sheet, after.sheet);
      }

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

  /**
   * Applies `blobs` (ascending seq) to a single Y.Doc and returns the extracted
   * plain text at each requested boundary, where the text at boundary `b` is
   * the state after all blobs with seq <= b — identical to previewAtSeq(b).
   */
  private async replayTextAtBoundaries(
    blobs: { seq: number; blob: Buffer }[],
    boundaries: number[]
  ): Promise<Map<number, string>> {
    const textAt = new Map<number, string>();
    if (boundaries.length === 0) return textAt;
    const ydoc = new Y.Doc();
    let lastText = "";
    let dirty = true; // empty doc not yet extracted
    const capture = async (): Promise<string> => {
      if (dirty) {
        lastText = (
          await this.extract.extractFromBytes(Y.encodeStateAsUpdate(ydoc))
        ).plainText;
        dirty = false;
      }
      return lastText;
    };
    let bi = 0;
    for (const { seq, blob } of blobs) {
      while (bi < boundaries.length && boundaries[bi] < seq) {
        textAt.set(boundaries[bi], await capture());
        bi += 1;
      }
      if (bi >= boundaries.length) break;
      Y.applyUpdate(ydoc, new Uint8Array(blob));
      dirty = true;
    }
    while (bi < boundaries.length) {
      textAt.set(boundaries[bi], await capture());
      bi += 1;
    }
    return textAt;
  }
}
