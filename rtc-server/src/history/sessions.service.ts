import { Injectable } from "@nestjs/common";
import { DocRepository } from "../persistence/doc-repository.service";
import { VersionsService, SheetSnapshot } from "./versions.service";
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

    const sessions: Session[] = [];
    for (const g of groups) {
      const before = await this.versions.previewAtSeq(docId, g.firstSeq - 1);
      const after = await this.versions.previewAtSeq(docId, g.lastSeq);
      const noop = before.plainText === after.plainText;
      sessions.push({
        ...g,
        noop,
        beforeText: before.plainText,
        afterText: after.plainText,
        changedCells: diffSheetCells(before.sheet, after.sheet),
      });
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
}
