import "../silence-benign-yjs";
import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type Provider,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type Klass,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  TableCellHeaderStates,
} from "@lexical/table";
import { $createListNode, $createListItemNode } from "@lexical/list";
import { $createLinkNode } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import { createLogger } from "../logger";

const log = createLogger("content-builder");

// Must match the editor's collaboration namespace (the Yjs root key).
const NAMESPACE = "ds-doc-editor-collab";

// The editor's real node set (incl. the custom-table-cell replacement), shared
// from the same lexical/yjs instances as this process. See lexical-extract.core.
const serverNodes: Array<Klass<LexicalNode>> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime CJS bundle, not a typed module
  require("../../vendor/server-nodes.cjs").AllDocEditorNodes;

// The custom table cell carries array/object props (border types/colors) that
// yjs can't store as XML attributes — syncing them throws "Unexpected content
// type" and corrupts the cell (dropping its children). Exclude them from collab
// sync; the node's constructor re-applies sensible defaults on read.
const excludedProperties: Map<Klass<LexicalNode>, Set<string>> = (() => {
  const map = new Map<Klass<LexicalNode>, Set<string>>();
  const cellKlass = serverNodes.find(
    (n) => typeof n === "function" && "getType" in n && n.getType() === "custom-table-cell"
  );
  if (cellKlass) {
    map.set(
      cellKlass,
      new Set(["__borderTypes", "__borderColors", "borderTypes", "borderColors"])
    );
  }
  return map;
})();

// Usable content width of a page (px) — the editable surface minus its padding.
// Tables with no explicit column widths spread their columns evenly across this
// so a fresh table fills the page instead of collapsing to its content width.
const DEFAULT_TABLE_WIDTH = 584;

// A run of text with its own formatting — lets a single paragraph/heading mix
// formats inline (e.g. bold just one word). When `runs` is given it wins over
// the flat `text`/`format` pair. Beyond the `format` bitfield flags, a run can
// carry inline CSS style (font size / color / highlight) and an optional link.
export type TextRun = {
  text: string;
  format?: TextFormatType[];
  // Inline style — written to the text node's CSS `style` string.
  fontSize?: number | string; // number → px
  color?: string; // text color (e.g. "#e11" or "rgb(...)")
  highlight?: string; // background-color (text highlight)
  // Wrap this run in a link node pointing at `href`.
  href?: string;
};

// One item in a list — plain text, or rich text via runs, plus a checkbox state
// for check lists.
export type ListItemSpec =
  | string
  | { text?: string; format?: TextFormatType[]; runs?: TextRun[]; checked?: boolean };

// High-level authoring ops, applied in order, appended to the document root.
export type ContentOp =
  | { op: "clear" }
  | {
      op: "paragraph";
      text?: string;
      format?: TextFormatType[];
      runs?: TextRun[];
      // shorthand inline style for the flat `text` form
      fontSize?: number | string;
      color?: string;
      highlight?: string;
    }
  | {
      op: "heading";
      level?: 1 | 2 | 3;
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
      // Per-column width in px. Missing/non-positive entries (and any columns
      // beyond the array) are treated as "auto" and share the leftover space
      // evenly. Omit entirely to size every column evenly.
      columnWidths?: number[];
      // Total width (px) to spread columns across. Defaults to the page width.
      tableWidth?: number;
    }
  | {
      // Multi-column layout (the editor's layout-container/layout-item nodes).
      // Each entry in `columns` is a list of block ops placed in that column.
      op: "columns";
      columns: ContentOp[][];
    }
  | {
      // An image (the editor's `image` node). `src` is the image URL.
      op: "image";
      src: string;
      altText?: string;
      width?: number; // px; 0/omitted → natural ("inherit")
      height?: number;
      maxWidth?: number; // px cap; defaults to page width
      caption?: string;
    }
  | {
      // Embed a link / media / file (the editor's `embed-media` node). Give the
      // URL as `src` and, optionally, its `mimeType` (e.g. "video/mp4",
      // "application/pdf", "text/html"). Files are embeds with a file mimeType.
      op: "embed";
      src: string;
      mimeType?: string;
      width?: number;
      height?: number;
      maxWidth?: number;
    }
  | {
      // Convenience alias for embedding a file by URL — same node as `embed`.
      op: "file";
      src: string;
      mimeType?: string;
      fileName?: string;
    };

function makeStubProvider(ydoc: Y.Doc): Provider {
  const awareness = new Awareness(ydoc);
  return {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as unknown as Provider;
}

// Split `total` px across `n` columns as evenly as possible, handing the
// rounding remainder to the leftmost columns so the parts sum exactly to `total`.
function evenWidths(n: number, total: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Resolve a px width for each of `numCols` columns. Explicit `columnWidths` win;
// any column left unspecified (missing entry, non-positive, or beyond the array)
// is "auto" and splits the width left over after the fixed columns evenly. With
// no explicit widths at all, every column gets an equal share of `tableWidth`.
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

// Build the CSS `style` string the editor uses for inline text styling.
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

// Append inline runs (each its own text node + format/style, optionally wrapped
// in a link) onto a parent element, so one paragraph/heading can mix formats —
// e.g. bold a single word, color another, or hyperlink a third.
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

// Render either rich `runs` or a flat `text` (+ optional whole-text style) onto
// a parent block element.
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

// Resolve a registered node class by its type string. The editor's custom nodes
// (layout, image, embed) live in the shared server bundle, not a typed module,
// and we build them via their `importJSON` (same path the editor uses to load a
// saved doc), so we don't have to hand-roll their internals.
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
  if (!k) throw new Error(`node '${type}' not in server bundle`);
  return k as unknown as { importJSON: (json: Record<string, unknown>) => LexicalNode };
}
function layoutKlass(type: "layout-container" | "layout-item"): {
  importJSON: (json: Record<string, unknown>) => ElementNode;
} {
  return nodeKlass(type) as { importJSON: (json: Record<string, unknown>) => ElementNode };
}

// Equal-fraction CSS grid template for an n-column layout.
function gridTemplate(n: number): string {
  return Array.from({ length: n }, () => "1fr").join(" ");
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
        // value is the 1-based ordinal for ordered lists.
        if (listType === "number") li.setValue(i + 1);
        fillBlock(li, spec);
        list.append(li);
      });
      parent.append(list);
      break;
    }
    case "columns": {
      const container = layoutKlass("layout-container").importJSON({
        type: "layout-container",
        templateColumns: gridTemplate(op.columns.length),
        version: 1,
      });
      op.columns.forEach((colOps) => {
        const item = layoutKlass("layout-item").importJSON({
          type: "layout-item",
          version: 1,
        });
        for (const subOp of colOps) applyOp(subOp, item);
        // A layout-item must hold at least one block.
        if (item.getChildrenSize() === 0) item.append($createParagraphNode());
        container.append(item);
      });
      parent.append(container);
      break;
    }
    case "image": {
      const img = nodeKlass("image").importJSON({
        type: "image",
        version: 1,
        src: op.src,
        altText: op.altText ?? "",
        // 0 → the node treats it as "inherit" (natural dimension).
        width: op.width ?? 0,
        height: op.height ?? 0,
        maxWidth: op.maxWidth ?? DEFAULT_TABLE_WIDTH,
        showCaption: op.caption ? true : false,
        caption: op.caption ?? "",
      });
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
      // The editor renders column widths from the table's colgroup (`colWidths`),
      // NOT from per-cell width. Without this, columns auto-size to content and
      // the table doesn't fill the page. Set both: colWidths drives layout, the
      // per-cell width keeps cells consistent if colWidths is ever dropped.
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
    default:
      throw new Error(`unknown op '${(op as { op: string }).op}'`);
  }
}

// Build a Yjs update (delta) that applies `ops` on top of `baseState` (the doc's
// current Yjs state, or null for an empty doc). Runs the editor's real headless
// Lexical↔Yjs binding so the produced bytes are exactly what the editor itself
// would emit. The returned delta is relative to baseState, so it merges cleanly
// onto the live doc.
export function buildOpsUpdate(
  baseState: Uint8Array | null,
  ops: ContentOp[]
): Uint8Array {
  const doc = new Y.Doc();
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

  // Yjs → Lexical (load existing content). Skip our own writes (origin === binding).
  // Wrap the sync: while applying the base state, a transient "Invalid access"
  // can surface mid-integration. It's benign (the discrete flush below rebuilds
  // the editor state correctly), but if it escaped this observer Yjs would
  // console.error the bare message — so swallow it to debug, matching the
  // extract path.
  binding.root.getSharedType().observeDeep((events, tx) => {
    if (tx.origin !== binding) {
      try {
        syncYjsChangesToLexical(binding, provider, events, false);
      } catch (e) {
        log.debug(`Y->L base-load sync skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
  });

  // Lexical → Yjs. Ignore the collaboration/historic echoes from the load above;
  // only our genuine op edits get written back.
  editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyLeaves, dirtyElements, normalizedNodes, tags }) => {
      if (tags.has("collaboration") || tags.has("historic")) return;
      syncLexicalUpdateToYjs(
        binding,
        provider,
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags
      );
    }
  );

  if (baseState && baseState.byteLength > 0) Y.applyUpdate(doc, baseState);
  // Flush the initial Yjs→Lexical sync into the editor state.
  editor.update(() => {}, { discrete: true });

  const beforeSV = Y.encodeStateVector(doc);
  editor.update(
    () => {
      const root = $getRoot();
      for (const op of ops) applyOp(op, root);
    },
    { discrete: true }
  );

  const delta = Y.encodeStateAsUpdate(doc, beforeSV);
  log.debug(`built ${ops.length} op(s) → ${delta.byteLength}B delta`);
  return delta;
}
