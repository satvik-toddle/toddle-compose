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

export type SheetSnapshot = {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
};

// Whiteboard Yjs model (mirrors frontend useYjsTldrawStore): 'tldraw' Map of TLRecords keyed by record id.
const TLDRAW_KEY = "tldraw";

export type WhiteboardSnapshot = {
  recordCount: number;
  shapeCount: number;
  pageCount: number;
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
  // WHITEBOARD docs only: record/shape/page counts at this seq; null otherwise.
  whiteboard: WhiteboardSnapshot | null;
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

// Whiteboard summary if this doc has the tldraw records root; null otherwise.
export function extractWhiteboard(ydoc: Y.Doc): WhiteboardSnapshot | null {
  if (!ydoc.share.has(TLDRAW_KEY)) return null;
  const yrecords = ydoc.getMap(TLDRAW_KEY);
  let shapeCount = 0;
  let pageCount = 0;
  for (const k of yrecords.keys()) {
    if (k.startsWith("shape:")) shapeCount += 1;
    else if (k.startsWith("page:")) pageCount += 1;
  }
  return { recordCount: yrecords.size, shapeCount, pageCount };
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

    // Extract sheet/whiteboard FIRST to fix their roots to concrete Array/Map types: the rawTexts getText() loop below would otherwise coerce them to Y.Text and break later typed reads.
    const sheet = extractSheet(ydoc);
    const whiteboard = extractWhiteboard(ydoc);

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

    // Sheets/whiteboards yield empty lexical text (every session would look like a no-op), so use a canonical serialization; DOC docs keep lexical text.
    const plainText = sheet
      ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
      : whiteboard
        ? JSON.stringify(whiteboard)
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
      whiteboard,
      elapsedMs,
    };
  }
}
