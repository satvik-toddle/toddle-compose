import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Y from "yjs";
import { Env } from "../config/env";
import { DocRepository } from "../persistence/doc-repository.service";
import { SheetSnapshot, extractSheet } from "../persistence/searchable-text";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import { createLogger } from "../logger";

const log = createLogger("sessions");

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

// Canonical Lexical empty paragraph: type 'paragraph', no indent, default alignment, no style, and no children beyond empty text nodes.
function isDefaultEmptyParagraph(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as {
    type?: unknown;
    children?: unknown;
    indent?: unknown;
    format?: unknown;
    style?: unknown;
  };
  if (n.type !== "paragraph") return false;
  if (n.indent) return false;
  // Element format: '', 0, undefined and 'start' all mean unaligned (see doc-diff nodeSignature).
  if (n.format !== "" && n.format !== 0 && n.format !== undefined && n.format !== "start") return false;
  if (n.style != null && (typeof n.style !== "string" || n.style.trim() !== "")) return false;
  const kids = n.children;
  if (kids === undefined) return true;
  if (!Array.isArray(kids)) return false;
  return kids.every((c) => {
    if (!c || typeof c !== "object") return false;
    const cn = c as { type?: unknown; text?: unknown };
    return cn.type === "text" && cn.text === "";
  });
}

// A boundary state that renders as an empty doc: "" (pre-first-open) or the canonical empty doc (root with one default-empty paragraph) the editor bootstraps on first open. Strict, so any real change still surfaces.
function isVisuallyEmpty(content: string): boolean {
  if (content === "") return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  const root = (parsed as { root?: unknown } | null)?.root;
  // No root object: not a Lexical doc (e.g. SHEET grid serialization) — leave on the exact-equality path.
  if (!root || typeof root !== "object") return false;
  const children = (root as { children?: unknown }).children;
  if (!Array.isArray(children) || children.length === 0) return true;
  if (children.length !== 1) return false;
  return isDefaultEmptyParagraph(children[0]);
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
    private readonly config: ConfigService<Env, true>
  ) {}

  private env<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  async buildSessions(
    docId: string,
    opts: { clientSub?: string | null; gapMs?: number; includeNoop?: boolean } = {}
  ): Promise<SessionList> {
    // Env-tunable (RTC_SESSION_GAP_MS) so local/E2E runs can use a short gap instead of waiting out 30s.
    const gapMs = opts.gapMs ?? this.env("RTC_SESSION_GAP_MS");
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
      // A tier-1 merged row stands in for the raw updates it coalesced; count those, not the one row.
      const edits = u.merged_count ?? 1;
      if (last && sameSub && withinGap && sameKind && !isArchive) {
        last.lastSeq = u.seq;
        last.endedAt = u.created_at;
        last.updateCount += edits;
        last.totalBytes += u.byte_len;
      } else {
        groups.push({
          firstSeq: u.seq,
          lastSeq: u.seq,
          clientSub: u.client_sub,
          startedAt: u.created_at,
          endedAt: u.created_at,
          updateCount: edits,
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
      // Compare full structure, not plainText: media/embed/formatting-only edits add no text and would otherwise be dropped as no-ops.
      // Both boundaries visually empty is also a noop: the pre-first-open state differs structurally from the bootstrapped canonical empty doc but renders identically.
      // TODO: enhance diffing for known same-looking cases — a kept session whose minor structural change renders an unmarked diff (e.g. attr-only tweaks on empty paragraphs, direction flips).
      const beforeContent = before?.content ?? "";
      const afterContent = after?.content ?? "";
      const noop =
        beforeContent === afterContent ||
        (isVisuallyEmpty(beforeContent) && isVisuallyEmpty(afterContent));
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

  // Single-pass equivalent of previewAtSeq per boundary. `text` is the human-readable content (plainText for DOC, grid serialization for SHEET); `content` is the no-op fingerprint (full lexicalJson for DOC so non-text edits register, grid serialization for SHEET).
  private async replayBoundaries(
    blobs: { seq: number; blob: Buffer }[],
    boundaries: number[]
  ): Promise<
    Map<number, { text: string; content: string; sheet: SheetSnapshot | null }>
  > {
    type Snap = { text: string; content: string; sheet: SheetSnapshot | null };
    const at = new Map<number, Snap>();
    if (boundaries.length === 0) return at;
    const ydoc = new Y.Doc();
    let last: Snap = { text: "", content: "", sheet: null };
    let dirty = true;
    const capture = async (): Promise<Snap> => {
      if (dirty) {
        // Read the grid off the live doc before worker extraction (see previewAtSeq).
        const sheet = extractSheet(ydoc);
        const { plainText, lexicalJson } = await this.extract.extractFromBytes(
          Y.encodeStateAsUpdate(ydoc)
        );
        const text = sheet
          ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
          : plainText;
        // SHEET: grid serialization already captures cell changes. DOC: lexicalJson captures media/embeds/formatting that plainText misses.
        const content = sheet ? text : (lexicalJson ?? plainText);
        last = { text, content, sheet };
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
