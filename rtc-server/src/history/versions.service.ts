import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import { createLogger } from "../logger";

const log = createLogger("versions");

// Sheet Yjs model (mirrors frontend sheetModel): 'rows' Array of per-row Y.Map keyed by '__id', 'colTypes' Map of column uuid -> { type, order } (stored opaquely here). DOC docs have no 'rows' root.
const ROWS_KEY = "rows";
const ID_KEY = "__id";
const COL_TYPE_KEY = "colTypes";

// What the caller needs back — lets us skip the work it won't read:
//   'all'   → everything (back-compat default)
//   'state' → yjs bytes only (DOC render); skip lexical extraction + rawTexts
//   'text'  → text/sheet only (SHEET render); skip the base64 full-state encode
export type PreviewInclude = "all" | "state" | "text";

export type SheetSnapshot = {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
};

export type VersionPreview = {
  docId: string;
  seq: number;
  headSeq: number;
  appliedUpdates: number;
  yjsStateBytes: number;
  lexicalJson: string | null;
  plainText: string;
  rawTexts: Record<string, string>;
  // SHEET docs only: reconstructed grid at this seq; null for DOCs.
  sheet: SheetSnapshot | null;
  // Full Yjs state at this seq (base64). The frontend binds it to a read-only
  // editor to render the snapshot through the exact live-collab path.
  yjsStateB64: string;
  elapsedMs: number;
};

// Extract grid state (row id + cell values, column types) if this is a sheet; null for non-sheet docs.
export function extractSheet(ydoc: Y.Doc): SheetSnapshot | null {
  if (!ydoc.share.has(ROWS_KEY)) return null;
  const yrows = ydoc.getArray(ROWS_KEY);
  const ycolTypes = ydoc.getMap(COL_TYPE_KEY);
  const rows = yrows.toArray().map((item) => {
    const m = item as Y.Map<unknown>;
    const values: Record<string, unknown> = {};
    for (const k of m.keys()) {
      if (k !== ID_KEY) values[k] = m.get(k);
    }
    const id = m.get(ID_KEY);
    return { rowId: typeof id === "string" ? id : null, values };
  });
  const colTypes: Record<string, unknown> = {};
  for (const k of ycolTypes.keys()) colTypes[k] = ycolTypes.get(k);
  return { rows, colTypes };
}

@Injectable()
export class VersionsService {
  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService
  ) {}

  async previewAtSeq(
    docId: string,
    seq: number,
    include: PreviewInclude = "all"
  ): Promise<VersionPreview> {
    const t0 = Date.now();
    const head = await this.repo.getHeadSeq(docId);
    const target = Math.max(0, Math.min(seq, head));
    const ydoc = new Y.Doc();
    if (target > 0) {
      const blobs = await this.repo.getDocUpdateBlobsUpTo(docId, target);
      for (const { blob } of blobs) {
        Y.applyUpdate(ydoc, new Uint8Array(blob));
      }
    }
    const yjsState = Y.encodeStateAsUpdate(ydoc);

    // Extract sheet FIRST to fix 'rows'/'colTypes' to concrete Array/Map types: the rawTexts getText() loop below would otherwise coerce 'rows' to Y.Text and break later typed reads. Cheap and local, so run it in every mode.
    const sheet = extractSheet(ydoc);

    // 'state' callers (DOC render) read only the yjs bytes, so skip the CPU-heavy headless-Lexical extraction and the rawTexts coercion loop entirely.
    let lexicalJson: string | null = null;
    let rawTexts: Record<string, string> = {};
    let plainText = "";
    if (include !== "state") {
      const extracted = await this.extract.extractFromBytes(yjsState);
      lexicalJson = extracted.lexicalJson;

      rawTexts = {};
      for (const key of ydoc.share.keys()) {
        try {
          const s = ydoc.getText(key).toString();
          if (s.length > 0) rawTexts[key] = s;
        } catch {
          /* not text-coercible (e.g. the sheet's Array/Map roots) */
        }
      }

      // Sheets yield empty lexical text (every session would look like a no-op), so use a canonical grid serialization; DOC docs keep lexical text.
      plainText = sheet
        ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
        : extracted.plainText;
    }

    // 'text' callers (SHEET render) discard the yjs bytes, so skip the base64 encode of the full state.
    const yjsStateB64 =
      include === "text" ? "" : Buffer.from(yjsState).toString("base64");

    const elapsedMs = Date.now() - t0;
    log.debug(
      `preview '${docId}' seq=${target}/${head} include=${include} json=${lexicalJson?.length ?? 0}B in ${elapsedMs}ms`
    );
    return {
      docId,
      seq: target,
      headSeq: head,
      appliedUpdates: target,
      yjsStateBytes: yjsState.byteLength,
      lexicalJson,
      plainText,
      rawTexts,
      sheet,
      yjsStateB64,
      elapsedMs,
    };
  }
}
