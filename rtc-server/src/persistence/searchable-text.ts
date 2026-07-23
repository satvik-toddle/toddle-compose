import * as Y from "yjs";

// Sheet Yjs model (mirrors frontend sheetModel): 'rows' Array of per-row Y.Map keyed by '__id', 'colTypes' Map of column uuid -> { type, order } (stored opaquely here). DOC docs have no 'rows' root.
const ROWS_KEY = "rows";
const ID_KEY = "__id";
const COL_TYPE_KEY = "colTypes";

export type SheetSnapshot = {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
};

// Extract grid state (row id + cell values, column types) if this is a sheet; null for non-sheet docs.
// Caveat: run on a Y.Doc BEFORE any getText() coerces the 'rows'/'colTypes' roots to Y.Text.
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

// Unified content-search projection: sheet grid text for SHEET docs, else DOC tree text.
// Never throws — a bad projection yields "" rather than breaking persistence/backfill.
// Single decode: flush/checkpoint call this on the main thread, so the sheet probe and
// the DOC walk share one throwaway Y.Doc instead of applying the full state twice.
export function extractSearchText(stateUpdate: Uint8Array): string {
  try {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, stateUpdate);
    const sheet = extractSheet(ydoc);
    if (sheet) return sheetToSearchText(sheet);
    return docTreeToSearchText(ydoc);
  } catch {
    return "";
  }
}

// Plain-text projection of a lexical-yjs DOC for content search, read straight off the
// shared Y tree (the 'root' Y.XmlText). Version-proof: unlike headless-Lexical extraction
// it needs no node registry, so a new/unknown node type can never blank the whole doc.
// Text runs within a node concatenate directly (so inline-formatting splits don't break
// words); block elements are separated by newline.
// NOTE: coerces the 'root' shared type — only call on a throwaway Y.Doc, never a live one.
export function docTreeToSearchText(ydoc: Y.Doc): string {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const n = node as {
      toDelta?: () => Array<{ insert?: unknown }>;
      toArray?: () => unknown[];
    };
    if (typeof n.toDelta === "function") {
      let delta: Array<{ insert?: unknown }> | null = null;
      try {
        delta = n.toDelta();
      } catch {
        /* not delta-coercible */
      }
      if (Array.isArray(delta)) {
        for (const op of delta) {
          if (typeof op.insert === "string") out.push(op.insert);
          else if (op.insert && typeof op.insert === "object") {
            visit(op.insert);
            out.push("\n");
          }
        }
      }
    } else if (typeof n.toArray === "function") {
      let arr: unknown[] | null = null;
      try {
        arr = n.toArray();
      } catch {
        /* not array-coercible */
      }
      if (Array.isArray(arr)) {
        for (const c of arr) visit(c);
        out.push("\n");
      }
    }
  };
  visit(ydoc.get("root", Y.XmlText));
  return out
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Flatten a sheet to searchable text: rows joined by "\n", string cell values by " ".
export function sheetToSearchText(sheet: SheetSnapshot): string {
  return sheet.rows
    .map((row) =>
      Object.values(row.values)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" ")
    )
    .join("\n");
}
