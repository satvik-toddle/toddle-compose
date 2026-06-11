import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import { createLogger } from "../logger";

const log = createLogger("versions");

// Sheet (ds-data-grid) Yjs model — mirrors the frontend SheetView:
//  • getArray('rows') → one Y.Map per row (stable '__id' + one key per column id)
//  • getMap('colTypes') → column id → cell type
// A DOC (lexical) doc has no 'rows' root, so sheet extraction is a no-op for it.
const ROWS_KEY = "rows";
const ID_KEY = "__id";
const COL_TYPE_KEY = "colTypes";

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
  // Present only for SHEET docs: the reconstructed grid at this seq. null for DOCs.
  sheet: SheetSnapshot | null;
  elapsedMs: number;
};

/**
 * If this Y.Doc is a sheet (has a 'rows' root array), pull out the grid state:
 * each row's stable id + its cell values, plus the per-column types. Returns null
 * for non-sheet docs so the lexical path is untouched.
 */
function extractSheet(ydoc: Y.Doc): SheetSnapshot | null {
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

  async previewAtSeq(docId: string, seq: number): Promise<VersionPreview> {
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

    // Pull the sheet out FIRST: this fixes 'rows'/'colTypes' to their concrete
    // Array/Map constructors. The rawTexts loop below calls getText() on every
    // share key, which would otherwise coerce the still-generic 'rows' root to a
    // Y.Text and make a later typed read throw. Returns null for non-sheet docs.
    const sheet = extractSheet(ydoc);

    // Extraction is async now (develop's worker-pool LexicalExtractService). Keep
    // the `lexicalText` alias — `plainText` is re-derived below (sheet vs lexical).
    const { lexicalJson, plainText: lexicalText } =
      await this.extract.extractFromBytes(yjsState);

    const rawTexts: Record<string, string> = {};
    for (const key of ydoc.share.keys()) {
      try {
        const s = ydoc.getText(key).toString();
        if (s.length > 0) rawTexts[key] = s;
      } catch {
        /* not text-coercible (e.g. the sheet's Array/Map roots) */
      }
    }

    // For a sheet, lexical extraction yields empty text, which would make EVERY
    // session look like a no-op (and get filtered out). Use a canonical
    // serialization of the grid as the "text" so a real cell/type change is
    // detected as a change. DOC docs keep the lexical plain text.
    const plainText = sheet
      ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
      : lexicalText;

    const elapsedMs = Date.now() - t0;
    log.debug(
      `preview '${docId}' seq=${target}/${head} json=${lexicalJson?.length ?? 0}B in ${elapsedMs}ms`
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
      elapsedMs,
    };
  }
}
