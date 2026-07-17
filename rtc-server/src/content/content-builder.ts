import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
} from "@lexical/yjs";
import {
  NAMESPACE,
  excludedProperties,
  makeStubProvider,
  serverNodes,
  withBenignYjsSilenced,
} from "../lexical-headless";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextFormatType,
  type TextNode,
} from "lexical";
import { $generateNodesFromDOM } from "@lexical/html";
import { parseHTML } from "linkedom";
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from "@lexical/table";
import { $createListNode, $createListItemNode } from "@lexical/list";
import { $createLinkNode } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import { createLogger } from "../logger";

const log = createLogger("content-builder");

// Invalid-ops error (bad target, missing field, unknown op): the caller's request is wrong, so the
// controller maps it to 400. Infrastructure failures stay plain Errors and surface as 5xx.
export class ContentOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentOpError";
  }
}

// Usable content width of a page (px) — editable surface minus padding; auto-width tables spread evenly across this.
const DEFAULT_TABLE_WIDTH = 582;

// A run of inline text with its own formatting/style/link; `runs` wins over the flat `text`/`format` pair.
export type TextRun = {
  text: string;
  format?: TextFormatType[];
  fontSize?: number | string; // number → px
  color?: string;
  highlight?: string; // background-color
  href?: string;
};

export type ListItemSpec =
  | string
  | { text?: string; format?: TextFormatType[]; runs?: TextRun[]; checked?: boolean };

// Lexical anchor/focus shape: top-level block index + char offset within that block's text.
export type SelPoint = { parentId: number; offset: number };

// High-level authoring ops, applied in order, appended to the document root.
export type ContentOp =
  | { op: "clear" }
  | {
      op: "paragraph";
      text?: string;
      format?: TextFormatType[];
      runs?: TextRun[];
      fontSize?: number | string;
      color?: string;
      highlight?: string;
    }
  | {
      op: "heading";
      level?: 1 | 2 | 3 | 4 | 5 | 6;
      text?: string;
      format?: TextFormatType[];
      runs?: TextRun[];
    }
  | { op: "quote"; text?: string; format?: TextFormatType[]; runs?: TextRun[] }
  | { op: "code"; text?: string; language?: string }
  | {
      op: "list";
      listType?: "bullet" | "number" | "check";
      items: ListItemSpec[];
    }
  | {
      op: "table";
      rows: string[][];
      header?: boolean;
      // Per-column px width; missing/non-positive/extra columns are "auto" and split leftover space evenly.
      columnWidths?: number[];
      tableWidth?: number; // total width to spread columns across; defaults to page width
    }
  | {
      // Multi-column layout (layout-container/layout-item); each `columns` entry is block ops for that column.
      op: "columns";
      columns: ContentOp[][];
      // Relative column widths (like CSS fr units), e.g. [1, 2] = second column twice as wide; defaults to equal.
      weights?: number[];
    }
  | {
      op: "image";
      src: string;
      altText?: string;
      width?: number; // px; 0/omitted → natural ("inherit")
      height?: number;
      maxWidth?: number; // px cap; defaults to page width
      caption?: string;
      href?: string; // wrap the image in a link
    }
  | {
      // embed-media node; `mimeType` e.g. "video/mp4"/"application/pdf"/"text/html". A file is an embed with a file mimeType.
      op: "embed";
      src: string;
      mimeType?: string;
      width?: number;
      height?: number;
      maxWidth?: number;
    }
  | {
      // Alias for embedding a file by URL — same node as `embed`.
      op: "file";
      src: string;
      mimeType?: string;
      fileName?: string;
    }
  // In-place structure edits addressed by top-level block index (same indices GET /content reports).
  | {
      // Re-weight an existing column layout, e.g. weights [1, 2] = second column twice as wide.
      op: "resizeColumns";
      columns: number; // block index of the layout-container
      weights: number[]; // one per column
    }
  | {
      op: "tableAddRow";
      table: number; // block index of the table
      cells?: string[]; // cell texts; missing → empty
      at?: number; // row index to insert BEFORE; omitted → append
    }
  | {
      op: "tableAddColumn";
      table: number;
      cells?: string[]; // one per row, top to bottom; missing → empty
      at?: number; // column index to insert BEFORE; omitted → append
      width?: number; // px
    }
  | { op: "tableDeleteRow"; table: number; row: number }
  | { op: "tableDeleteColumn"; table: number; col: number }
  | {
      // Replace one cell's content (and optionally its background color).
      op: "tableSetCell";
      table: number;
      row: number;
      col: number;
      text?: string;
      runs?: TextRun[];
      background?: string; // cell background-color
    }
  | {
      // Resize an existing table's columns (same width semantics as the `table` op).
      op: "tableSetWidths";
      table: number;
      columnWidths?: number[];
      tableWidth?: number;
    }
  | { op: "align"; block: number; align: "left" | "center" | "right" | "justify" }
  // In-place edits build a real RangeSelection (anchor→focus) and run the editor's own formatText/insertText,
  // so the Yjs op matches a real user edit — minimal and CRDT-safe. Point = {parentId: block index, offset: char offset}.
  | {
      op: "format";
      anchor: SelPoint;
      focus: SelPoint;
      operations?: TextFormatType[]; // alias: `format`
      format?: TextFormatType[];
      color?: string;
      fontSize?: number | string;
      highlight?: string;
      href?: string; // wrap selected range in a link (same-block only)
    }
  | {
      // No "replace" op by design: replace = `delete` the range then `insert`, so every edit is explicit (block + offsets).
      op: "delete";
      anchor: SelPoint;
      focus: SelPoint;
    }
  | {
      // Insert at a caret (anchor), or a new block via insertAfter/insertBefore/parentOffset (content from `block` op or `text`).
      op: "insert";
      text?: string;
      anchor?: SelPoint;
      operations?: TextFormatType[];
      format?: TextFormatType[];
      color?: string;
      fontSize?: number | string;
      highlight?: string;
      insertAfter?: number;
      insertBefore?: number;
      parentOffset?: number;
      block?: ContentOp;
    };

// True if any op — including ops nested via insert.block or columns — destroys existing content; the live-editor guard gates on this, so nesting can't smuggle a clear past it.
export function hasDestructiveOp(ops: ContentOp[]): boolean {
  return ops.some((op) => {
    if (op.op === "clear") return true;
    if (op.op === "insert" && op.block) return hasDestructiveOp([op.block]);
    if (op.op === "columns") return op.columns.some((col) => hasDestructiveOp(col));
    return false;
  });
}

// Split `total` px across `n` columns evenly; remainder goes to leftmost columns so parts sum to `total`.
function evenWidths(n: number, total: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Resolve px width per column: explicit `columnWidths` win; unspecified columns are "auto" and split the leftover evenly.
function resolveColumnWidths(
  numCols: number,
  tableWidth: number,
  columnWidths?: number[]
): number[] {
  if (numCols <= 0) return [];
  if (!columnWidths || columnWidths.length === 0) {
    return evenWidths(numCols, tableWidth);
  }
  const explicit = Array.from({ length: numCols }, (_, i) => {
    const w = columnWidths[i];
    return typeof w === "number" && w > 0 ? Math.round(w) : null;
  });
  const autoCount = explicit.filter((w) => w === null).length;
  if (autoCount === 0) return explicit as number[];
  const fixedTotal = explicit.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const autoWidths = evenWidths(autoCount, Math.max(0, tableWidth - fixedTotal));
  let ai = 0;
  return explicit.map((w) => w ?? autoWidths[ai++]);
}

function styleString(s: {
  fontSize?: number | string;
  color?: string;
  highlight?: string;
}): string {
  const parts: string[] = [];
  if (s.fontSize !== undefined) {
    parts.push(`font-size: ${typeof s.fontSize === "number" ? `${s.fontSize}px` : s.fontSize};`);
  }
  if (s.color) parts.push(`color: ${s.color};`);
  if (s.highlight) parts.push(`background-color: ${s.highlight};`);
  return parts.join(" ");
}

type TextStyle = {
  format?: TextFormatType[];
  fontSize?: number | string;
  color?: string;
  highlight?: string;
};

function appendText(parent: ElementNode, text: string, style?: TextStyle): void {
  const node = $createTextNode(text);
  for (const f of style?.format ?? []) node.toggleFormat(f);
  const css = style ? styleString(style) : "";
  if (css) node.setStyle(css);
  parent.append(node);
}

// Append inline runs (each its own text node + format/style, optionally link-wrapped) so one block can mix formats.
function appendRuns(parent: ElementNode, runs: TextRun[]): void {
  for (const run of runs) {
    if (run.href) {
      const link = $createLinkNode(run.href);
      appendText(link, run.text, run);
      parent.append(link);
    } else {
      appendText(parent, run.text, run);
    }
  }
}

// Render rich `runs` or a flat `text` (+ optional whole-text style) onto a parent block.
function fillBlock(
  parent: ElementNode,
  spec: {
    text?: string;
    runs?: TextRun[];
    format?: TextFormatType[];
    fontSize?: number | string;
    color?: string;
    highlight?: string;
  }
): void {
  if (spec.runs?.length) appendRuns(parent, spec.runs);
  else if (spec.text) appendText(parent, spec.text, spec);
}

// In-place editing: operate on the doc's existing content and touch only targeted text, so the Yjs delta stays minimal.
type InlineStyleSpec = {
  format?: TextFormatType[];
  fontSize?: number | string;
  color?: string;
  highlight?: string;
};

function styleAdditions(s: InlineStyleSpec): Record<string, string> {
  const a: Record<string, string> = {};
  if (s.fontSize !== undefined) {
    a["font-size"] = typeof s.fontSize === "number" ? `${s.fontSize}px` : s.fontSize;
  }
  if (s.color) a["color"] = s.color;
  if (s.highlight) a["background-color"] = s.highlight;
  return a;
}

// Merge `adds` into an existing CSS `style` string (set/override per property).
function mergeCss(existing: string, adds: Record<string, string>): string {
  const map = new Map<string, string>();
  for (const decl of existing.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) map.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  for (const [k, v] of Object.entries(adds)) map.set(k, v);
  return [...map.entries()].map(([k, v]) => `${k}: ${v};`).join(" ");
}

function collectTextNodes(node: LexicalNode, out: TextNode[]): void {
  if ($isTextNode(node)) out.push(node);
  else if ($isElementNode(node)) for (const c of node.getChildren()) collectTextNodes(c, out);
}
function textNodesUnder(scope: LexicalNode | null): TextNode[] {
  const out: TextNode[] = [];
  const roots = scope ? [scope] : $getRoot().getChildren();
  for (const r of roots) collectTextNodes(r, out);
  return out;
}

function blockAt(parentId: number): ElementNode | null {
  const kids = $getRoot().getChildren();
  const b = kids[Number(parentId)];
  return b && $isElementNode(b) ? b : null;
}

// Map a char offset within a block to (text node, local offset); past-end clamps to the last text node's end.
function pointInBlock(
  block: ElementNode,
  off: number
): { node: TextNode; offset: number } | null {
  const texts = textNodesUnder(block);
  if (texts.length === 0) return null;
  let base = 0;
  for (const t of texts) {
    const len = t.getTextContent().length;
    if (off <= base + len) return { node: t, offset: Math.max(0, off - base) };
    base += len;
  }
  const last = texts[texts.length - 1];
  return { node: last, offset: last.getTextContent().length };
}

// Build and activate a RangeSelection over [start, end) chars of `block`, as a user's selection would be.
function selectRange(
  block: ElementNode,
  start: number,
  end: number
): RangeSelection | null {
  const a = pointInBlock(block, start);
  const f = pointInBlock(block, end);
  if (!a || !f) return null;
  const sel = $createRangeSelection();
  sel.anchor.set(a.node.getKey(), a.offset, "text");
  sel.focus.set(f.node.getKey(), f.offset, "text");
  $setSelection(sel);
  const active = $getSelection();
  return $isRangeSelection(active) ? active : null;
}

// Build + activate a RangeSelection from anchor→focus points; also returns the block when both points share one (for ranged styling).
function selectPoints(
  anchor: SelPoint,
  focus: SelPoint
): { sel: RangeSelection; block: ElementNode | null } | null {
  const ab = blockAt(anchor.parentId);
  const fb = blockAt(focus.parentId);
  if (!ab || !fb) return null;
  const a = pointInBlock(ab, anchor.offset);
  const f = pointInBlock(fb, focus.offset);
  if (!a || !f) return null;
  const sel = $createRangeSelection();
  sel.anchor.set(a.node.getKey(), a.offset, "text");
  sel.focus.set(f.node.getKey(), f.offset, "text");
  $setSelection(sel);
  const active = $getSelection();
  if (!$isRangeSelection(active)) return null;
  return { sel: active, block: anchor.parentId === focus.parentId ? ab : null };
}

// Split `block` at the boundaries and return the text nodes exactly covering [start, end), for applying inline style to just the selection.
function rangeTextNodes(block: ElementNode, start: number, end: number): TextNode[] {
  // Normalize backward ranges (anchor after focus) — RangeSelection handles them, so this must too or styles silently drop.
  if (start > end) [start, end] = [end, start];
  const segs: TextNode[] = [];
  let base = 0;
  for (const t of textNodesUnder(block)) {
    const len = t.getTextContent().length;
    const ns = Math.max(0, start - base);
    const ne = Math.min(len, end - base);
    base += len;
    if (ns >= ne) continue;
    const offs: number[] = [];
    if (ns > 0) offs.push(ns);
    if (ne < len) offs.push(ne);
    if (offs.length === 0) {
      segs.push(t);
    } else {
      const parts = t.splitText(...offs);
      let acc = 0;
      for (const p of parts) {
        if (acc === ns) { segs.push(p); break; }
        acc += p.getTextContent().length;
      }
    }
  }
  return segs;
}

// Resolve a registered node class by type string; custom nodes live in the untyped server bundle and are built via their `importJSON`.
function nodeKlass(type: string): {
  importJSON: (json: Record<string, unknown>) => LexicalNode;
} {
  const k = serverNodes.find((n) => {
    try {
      return (n as unknown as { getType(): string }).getType() === type;
    } catch {
      return false;
    }
  });
  if (!k) throw new ContentOpError(`node '${type}' not in server bundle`);
  return k as unknown as { importJSON: (json: Record<string, unknown>) => LexicalNode };
}
function layoutKlass(type: "layout-container" | "layout-item"): {
  importJSON: (json: Record<string, unknown>) => ElementNode;
} {
  return nodeKlass(type) as { importJSON: (json: Record<string, unknown>) => ElementNode };
}

// Mirrors the editor's layout model: weights are scaled onto a fixed 20-unit grid; the container
// stores the fr template and each layout-item gets a "start / end" gridColumn span.
const TOTAL_GRID_UNITS = 20;
function gridSpans(weights: number[]): { template: string; ranges: string[] } {
  const total = weights.reduce((a, b) => a + b, 0) || weights.length;
  const scaled = weights.map((w) => Math.max(1, Math.round((w / total) * TOTAL_GRID_UNITS)));
  const diff = scaled.reduce((a, b) => a + b, 0) - TOTAL_GRID_UNITS;
  if (diff !== 0 && scaled.length) {
    scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1] - diff);
  }
  const ranges: string[] = [];
  let cursor = 1;
  for (const span of scaled) {
    ranges.push(`${cursor} / ${cursor + span}`);
    cursor += span;
  }
  return { template: scaled.map((s) => `${s}fr`).join(" "), ranges };
}

function tableAt(index: number): TableNode {
  const b = blockAt(index);
  if (!b || !$isTableNode(b)) throw new ContentOpError(`no table at block index ${index}`);
  return b;
}
function tableRows(table: TableNode): TableRowNode[] {
  return table.getChildren().filter($isTableRowNode);
}
function rowCells(row: TableRowNode): TableCellNode[] {
  return row.getChildren().filter($isTableCellNode);
}
function makeCell(text: string, headerState: number, width?: number): TableCellNode {
  const cell = $createTableCellNode(headerState, 1, width);
  const p = $createParagraphNode();
  appendText(p, text);
  cell.append(p);
  return cell;
}

function applyOp(op: ContentOp, parent: ElementNode): void {
  switch (op.op) {
    case "clear":
      parent.clear();
      break;
    case "paragraph": {
      const p = $createParagraphNode();
      fillBlock(p, op);
      parent.append(p);
      break;
    }
    case "heading": {
      const h = $createHeadingNode(`h${op.level ?? 1}` as HeadingTagType);
      fillBlock(h, op);
      parent.append(h);
      break;
    }
    case "quote": {
      const q = $createQuoteNode();
      fillBlock(q, op);
      parent.append(q);
      break;
    }
    case "code": {
      const c = $createCodeNode(op.language);
      if (op.text) appendText(c, op.text);
      parent.append(c);
      break;
    }
    case "list": {
      const listType = op.listType ?? "bullet";
      const list = $createListNode(listType);
      op.items.forEach((item, i) => {
        const spec = typeof item === "string" ? { text: item } : item;
        const li = $createListItemNode(
          listType === "check" ? Boolean(spec.checked) : undefined
        );
        if (listType === "number") li.setValue(i + 1); // 1-based ordinal
        fillBlock(li, spec);
        list.append(li);
      });
      parent.append(list);
      break;
    }
    case "columns": {
      const weights =
        op.weights && op.weights.length === op.columns.length
          ? op.weights
          : op.columns.map(() => 1);
      const { template, ranges } = gridSpans(weights);
      const container = layoutKlass("layout-container").importJSON({
        type: "layout-container",
        templateColumns: template,
        version: 1,
      });
      op.columns.forEach((colOps, i) => {
        const item = layoutKlass("layout-item").importJSON({
          type: "layout-item",
          version: 1,
          dataGridColumn: ranges[i], // editor renders a fixed 20-unit grid; items position via this span
        });
        for (const subOp of colOps) applyOp(subOp, item);
        if (item.getChildrenSize() === 0) item.append($createParagraphNode()); // layout-item needs >=1 block
        container.append(item);
      });
      parent.append(container);
      break;
    }
    case "resizeColumns": {
      const block = blockAt(op.columns);
      if (!block || block.getType() !== "layout-container") {
        throw new ContentOpError(`resizeColumns: no column layout at block index ${op.columns}`);
      }
      const items = block.getChildren().filter($isElementNode);
      if (op.weights.length !== items.length) {
        throw new ContentOpError(`resizeColumns: ${op.weights.length} weight(s) for ${items.length} column(s)`);
      }
      const { template, ranges } = gridSpans(op.weights);
      (block as unknown as { setTemplateColumns(t: string): void }).setTemplateColumns(template);
      items.forEach((item, i) =>
        (item as unknown as { setDataGridColumn(v: string): void }).setDataGridColumn(ranges[i])
      );
      break;
    }
    case "image": {
      const img = nodeKlass("image").importJSON({
        type: "image",
        version: 1,
        src: op.src,
        altText: op.altText ?? "",
        width: op.width ?? 0, // 0 → node treats as "inherit" (natural)
        height: op.height ?? 0,
        maxWidth: op.maxWidth ?? DEFAULT_TABLE_WIDTH,
        showCaption: op.caption ? true : false,
      });
      // The vendor node's importJSON drops caption/showCaption/link; its setters are the supported path.
      const rich = img as unknown as {
        setCaption?: (c: string) => void;
        setShowCaption?: (b: boolean) => void;
        setLink?: (l: string) => void;
      };
      if (op.caption) {
        rich.setCaption?.(op.caption);
        rich.setShowCaption?.(true);
      }
      if (op.href) rich.setLink?.(op.href);
      parent.append(img);
      break;
    }
    case "embed":
    case "file": {
      const embed = nodeKlass("embed-media").importJSON({
        type: "embed-media",
        version: 1,
        src: op.src,
        mimeType: op.mimeType ?? "text/html",
        width: "width" in op ? (op.width ?? 0) : 0,
        height: "height" in op ? (op.height ?? 0) : 0,
        maxWidth: "maxWidth" in op ? (op.maxWidth ?? DEFAULT_TABLE_WIDTH) : DEFAULT_TABLE_WIDTH,
      });
      parent.append(embed);
      break;
    }
    case "table": {
      const numCols = op.rows.reduce((max, row) => Math.max(max, row.length), 0);
      const widths = resolveColumnWidths(
        numCols,
        op.tableWidth ?? DEFAULT_TABLE_WIDTH,
        op.columnWidths
      );
      const table = $createTableNode();
      // Editor lays out columns from the table's colgroup (`colWidths`), not per-cell width; we set both for robustness.
      table.setColWidths(widths);
      op.rows.forEach((row, r) => {
        const tr = $createTableRowNode();
        row.forEach((cellText, c) => {
          const header = op.header && r === 0;
          const cell = $createTableCellNode(
            header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
            1,
            widths[c]
          );
          const p = $createParagraphNode();
          appendText(p, cellText ?? "");
          cell.append(p);
          tr.append(cell);
        });
        table.append(tr);
      });
      parent.append(table);
      break;
    }
    case "tableAddRow": {
      const table = tableAt(op.table);
      const rows = tableRows(table);
      const numCols = rows[0] ? rowCells(rows[0]).length : (op.cells?.length ?? 1);
      const widths = table.getColWidths() ?? [];
      const tr = $createTableRowNode();
      for (let c = 0; c < numCols; c++) {
        tr.append(makeCell(op.cells?.[c] ?? "", TableCellHeaderStates.NO_STATUS, widths[c]));
      }
      if (op.at !== undefined && rows[op.at]) rows[op.at].insertBefore(tr);
      else table.append(tr);
      break;
    }
    case "tableAddColumn": {
      const table = tableAt(op.table);
      const rows = tableRows(table);
      if (rows.length === 0) throw new ContentOpError(`tableAddColumn: table at ${op.table} has no rows`);
      rows.forEach((row, r) => {
        const cells = rowCells(row);
        const ref = op.at !== undefined ? cells[op.at] : undefined;
        // A new column is a data column: start NO_STATUS and inherit only the ROW bit from the
        // same-row neighbour (Lexical's own rule), so it belongs to a header ROW but never
        // becomes a header COLUMN — copying the row's full state leaked COLUMN/BOTH into it.
        const neighbour = ref ?? cells[cells.length - 1];
        const state =
          (neighbour?.getHeaderStyles() ?? 0) & TableCellHeaderStates.ROW;
        const cell = makeCell(op.cells?.[r] ?? "", state, op.width);
        if (ref) ref.insertBefore(cell);
        else row.append(cell);
      });
      const widths = table.getColWidths();
      if (widths) {
        const w = [...widths];
        const insertAt = op.at !== undefined && op.at <= w.length ? op.at : w.length;
        w.splice(insertAt, 0, op.width ?? Math.round(DEFAULT_TABLE_WIDTH / (w.length + 1)));
        table.setColWidths(w);
      }
      break;
    }
    case "tableDeleteRow": {
      const table = tableAt(op.table);
      const row = tableRows(table)[op.row];
      if (!row) throw new ContentOpError(`tableDeleteRow: no row ${op.row} in table at ${op.table}`);
      row.remove();
      break;
    }
    case "tableDeleteColumn": {
      const table = tableAt(op.table);
      const rows = tableRows(table);
      if (!rows.some((r) => rowCells(r)[op.col])) {
        throw new ContentOpError(`tableDeleteColumn: no column ${op.col} in table at ${op.table}`);
      }
      for (const row of rows) rowCells(row)[op.col]?.remove();
      const widths = table.getColWidths();
      if (widths && op.col < widths.length) {
        const w = [...widths];
        w.splice(op.col, 1);
        table.setColWidths(w);
      }
      break;
    }
    case "tableSetCell": {
      const table = tableAt(op.table);
      const row = tableRows(table)[op.row];
      const cell = row ? rowCells(row)[op.col] : undefined;
      if (!cell) throw new ContentOpError(`tableSetCell: no cell ${op.row},${op.col} in table at ${op.table}`);
      if (op.text !== undefined || op.runs) {
        cell.clear();
        const p = $createParagraphNode();
        fillBlock(p, { text: op.text, runs: op.runs });
        cell.append(p);
      }
      if (op.background !== undefined) {
        // custom-table-cell stores background as a plain prop; no setter exposed, so write it directly.
        (cell.getWritable() as unknown as { __backgroundColor: string | null }).__backgroundColor =
          op.background || null;
      }
      break;
    }
    case "tableSetWidths": {
      const table = tableAt(op.table);
      const rows = tableRows(table);
      const numCols = rows.reduce((m, r) => Math.max(m, rowCells(r).length), 0);
      if (numCols === 0) throw new ContentOpError(`tableSetWidths: table at ${op.table} has no cells`);
      const widths = resolveColumnWidths(
        numCols,
        op.tableWidth ?? DEFAULT_TABLE_WIDTH,
        op.columnWidths
      );
      table.setColWidths(widths);
      for (const row of rows) rowCells(row).forEach((cell, c) => cell.setWidth(widths[c]));
      break;
    }
    case "align": {
      const block = blockAt(op.block);
      if (!block) throw new ContentOpError(`align: no block at index ${op.block}`);
      block.setFormat(op.align);
      break;
    }
    case "format": {
      const picked = selectPoints(op.anchor, op.focus);
      // Throw (→ 400), don't silently skip: the endpoint would otherwise report ok for an op that did nothing.
      if (!picked) throw new ContentOpError(`format: no text at ${op.anchor.parentId}:${op.anchor.offset}→${op.focus.parentId}:${op.focus.offset} (missing or empty block)`);
      const fmts = op.operations ?? op.format ?? [];
      for (const f of fmts) if (!picked.sel.hasFormat(f)) picked.sel.formatText(f);
      const adds = styleAdditions(op);
      if (Object.keys(adds).length > 0 && picked.block) {
        for (const node of rangeTextNodes(picked.block, op.anchor.offset, op.focus.offset)) {
          node.setStyle(mergeCss(node.getStyle(), adds));
        }
      } else if (Object.keys(adds).length > 0) {
        for (const node of picked.sel.getNodes())
          if ($isTextNode(node)) node.setStyle(mergeCss(node.getStyle(), adds));
      }
      // Hyperlink: split the range into its covering text nodes and move them into a LinkNode. Same-block only.
      if (op.href !== undefined && picked.block) {
        const linkNodes = rangeTextNodes(picked.block, op.anchor.offset, op.focus.offset);
        if (linkNodes.length > 0) {
          const link = $createLinkNode(op.href);
          linkNodes[0].insertBefore(link);
          for (const node of linkNodes) link.append(node);
        }
      } else if (op.href !== undefined) {
        log.debug(`format: href needs a same-block selection`);
      }
      log.debug(`format ${op.anchor.parentId}:${op.anchor.offset}→${op.focus.parentId}:${op.focus.offset}`);
      break;
    }
    case "delete": {
      const picked = selectPoints(op.anchor, op.focus);
      if (!picked) throw new ContentOpError(`delete: no text at ${op.anchor.parentId}:${op.anchor.offset}→${op.focus.parentId}:${op.focus.offset} (missing or empty block)`);
      picked.sel.insertText(""); // delete = type "" over the selection (editor's own delete)
      log.debug(`delete ${op.anchor.parentId}:${op.anchor.offset}→${op.focus.parentId}:${op.focus.offset}`);
      break;
    }
    case "insert": {
      // (a) inline caret insertion at an anchor point
      if (op.anchor !== undefined) {
        const block = blockAt(op.anchor.parentId);
        if (!block) throw new ContentOpError(`insert: no block at index ${op.anchor.parentId}`);
        if (!op.text) throw new ContentOpError(`insert: anchor requires text`);
        // Clamp to the block's text length so the styling range below matches where the caret
        // actually landed: pointInBlock clamps a past-end offset to the end, so an unclamped
        // `at` would select an empty out-of-range span and silently drop format/color.
        let at = Math.min(op.anchor.offset, block.getTextContent().length);
        const sel = selectRange(block, at, at); // collapsed caret
        if (sel) {
          sel.insertText(op.text);
        } else {
          // Empty block: no text node to anchor a caret to — append the text directly (offset can only be 0).
          at = 0;
          block.append($createTextNode(op.text));
        }
        const adds = styleAdditions(op);
        const fmts = op.operations ?? op.format ?? [];
        if (Object.keys(adds).length > 0 || fmts.length > 0) {
          const sel2 = selectRange(block, at, at + op.text.length);
          if (sel2) for (const f of fmts) if (!sel2.hasFormat(f)) sel2.formatText(f);
          if (Object.keys(adds).length > 0)
            for (const node of rangeTextNodes(block, at, at + op.text.length))
              node.setStyle(mergeCss(node.getStyle(), adds));
        }
        log.debug(`insert text ${op.anchor.parentId}@${op.anchor.offset}`);
        break;
      }
      // (b) new block: build by appending to root, then move the new node(s) into position.
      const root = $getRoot();
      const kids = root.getChildren();
      const before = root.getChildrenSize();
      if (op.block) {
        applyOp(op.block, root);
      } else if (op.text !== undefined) {
        const p = $createParagraphNode();
        appendText(p, op.text, {
          format: op.operations ?? op.format,
          color: op.color,
          fontSize: op.fontSize,
          highlight: op.highlight,
        });
        root.append(p);
      }
      const built = root.getChildren().slice(before);
      if (built.length === 0) { log.debug("insert: nothing to insert"); break; }
      if (op.insertAfter !== undefined && kids[op.insertAfter]) {
        let ref: LexicalNode = kids[op.insertAfter];
        for (const node of built) { ref.insertAfter(node); ref = node; }
      } else if (op.insertBefore !== undefined && kids[op.insertBefore]) {
        for (const node of built) kids[op.insertBefore].insertBefore(node);
      } else if (op.parentOffset !== undefined && kids[op.parentOffset]) {
        for (const node of built) kids[op.parentOffset].insertBefore(node);
      } // else: leave appended at end
      log.debug(`insert block(s)=${built.length}`);
      break;
    }
    default:
      throw new ContentOpError(`unknown op '${(op as { op: string }).op}'`);
  }
}

// Build a Yjs delta applying `ops` on top of `baseState` (null = empty doc), via the editor's real headless Lexical↔Yjs binding so the bytes match the editor's own and merge cleanly.
export function buildOpsUpdate(
  baseState: Uint8Array | null,
  ops: ContentOp[]
): Uint8Array {
  return buildUpdate(baseState, (editor) => {
    editor.update(
      () => {
        const root = $getRoot();
        for (const op of ops) applyOp(op, root);
      },
      { discrete: true }
    );
  });
}

// Replace the WHOLE doc body with the parsed HTML, atomically: clear the root then append the
// nodes @lexical/html produces from the HTML. Emitted as one Yjs delta on top of `baseState`, so
// the CRDT merges it regardless of who is connected (unlike destructive `clear`, no live-editor gate).
export function buildHtmlReplaceUpdate(
  baseState: Uint8Array | null,
  html: string
): Uint8Array {
  return buildUpdate(baseState, (editor) => {
    editor.update(
      () => {
        const root = $getRoot();
        const dom = htmlToDom(html);
        const nodes = $generateNodesFromDOM(
          editor,
          dom as unknown as Parameters<typeof $generateNodesFromDOM>[1]
        );
        root.clear();
        for (const node of nodes) {
          // Root may hold only ElementNodes/DecoratorNodes — never a bare inline TextNode
          // ($generateNodesFromDOM wraps top-level inlines, but guard the odd leftover).
          if ($isElementNode(node) || !$isTextNode(node)) {
            root.append(node);
          } else {
            const p = $createParagraphNode();
            p.append(node);
            root.append(p);
          }
        }
      },
      { discrete: true }
    );
  });
}

// Shared temp-doc lifecycle: run `mutate` (which performs the editor.update that emits the delta) and
// return the incremental Yjs update, always destroying the temp doc (a throwing mutate included) so
// the stub Awareness cleanup interval and retained graph never leak.
function buildUpdate(
  baseState: Uint8Array | null,
  mutate: (editor: LexicalEditor, beforeSV: Uint8Array) => void
): Uint8Array {
  const doc = new Y.Doc();
  try {
    return buildUpdateInner(doc, baseState, mutate);
  } finally {
    doc.destroy();
  }
}

function buildUpdateInner(
  doc: Y.Doc,
  baseState: Uint8Array | null,
  mutate: (editor: LexicalEditor, beforeSV: Uint8Array) => void
): Uint8Array {
  const editor = createHeadlessEditor({
    namespace: NAMESPACE,
    nodes: serverNodes,
    onError: (e) => {
      throw e;
    },
  });
  const docMap = new Map<string, Y.Doc>([[NAMESPACE, doc]]);
  const provider = makeStubProvider(doc);
  const binding: Binding = createBinding(
    editor,
    provider,
    NAMESPACE,
    doc,
    docMap,
    excludedProperties
  );

  // Yjs → Lexical (load existing content), skipping our own writes; only the benign transient "Invalid access" is swallowed (discrete flush below rebuilds correctly) — anything else means the base failed to load and offsets would target the wrong content, so abort the edit.
  binding.root.getSharedType().observeDeep((events, tx) => {
    if (tx.origin !== binding) {
      try {
        withBenignYjsSilenced(() =>
          syncYjsChangesToLexical(binding, provider, events, false)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/Invalid access|Add Yjs type/i.test(msg)) throw e;
        log.debug(`Y->L base-load sync skipped benign: ${msg}`);
      }
    }
  });

  // Lexical → Yjs; ignore collaboration/historic echoes from the load so only our op edits get written back.
  editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyLeaves, dirtyElements, normalizedNodes, tags }) => {
      if (tags.has("collaboration") || tags.has("historic")) return;
      withBenignYjsSilenced(() =>
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags
        )
      );
    }
  );

  if (baseState && baseState.byteLength > 0) Y.applyUpdate(doc, baseState);
  editor.update(() => {}, { discrete: true }); // flush initial Yjs→Lexical sync
  // A cleared base queues @lexical/yjs's empty-root paragraph restore as a separate update
  // (headless editors never auto-flush it); left queued it merges into the ops cycle below,
  // tagging it 'collaboration' so the L→Y listener skips our writes and the delta comes out empty.
  editor.update(() => {}, { discrete: true });
  // That restore paragraph lives only in Lexical (its tagged cycle never syncs to Yjs). Drop it in
  // a tagged cycle of our own — so the removal doesn't try to sync either — keeping block indices
  // during ops aligned with the doc the client read via GET /content.
  editor.update(
    () => {
      const root = $getRoot();
      if (binding.root.isEmpty() && root.getChildrenSize() === 1) {
        const only = root.getFirstChild();
        if (only && $isElementNode(only) && only.getTextContent() === "") only.remove();
      }
    },
    { discrete: true, tag: "collaboration" }
  );

  const beforeSV = Y.encodeStateVector(doc);
  mutate(editor, beforeSV);

  const delta = Y.encodeStateAsUpdate(doc, beforeSV);
  log.debug(`built delta → ${delta.byteLength}B`);
  return delta;
}

// Parse an HTML string into a linkedom DOM document. linkedom does not auto-wrap a body-fragment
// (a leading block tag lands outside <body>), so wrap in a document skeleton; body-level <meta>/
// wrapper tags with no Lexical conversion are simply ignored by $generateNodesFromDOM.
function htmlToDom(html: string) {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><head></head><body>${normalizeHtmlPre(html)}</body></html>`
  );
  return document;
}

// Minimal pre-parse normalization ported from the editor's paste converter
// (doc-editor CustomPastePlugin/utils.js $parseHtmlToNodes): downgrade h4–h6 to h3 since the
// editor only supports h1–h3. Kept intentionally small; extend here as fidelity needs grow.
function normalizeHtmlPre(html: string): string {
  return html.replace(/<(\/?)h[4-6]([\s>])/gi, "<$1h3$2");
}
