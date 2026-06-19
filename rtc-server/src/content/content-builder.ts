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
import { $createHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  TableCellHeaderStates,
} from "@lexical/table";
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

// High-level authoring ops, applied in order, appended to the document root.
export type ContentOp =
  | { op: "clear" }
  | { op: "paragraph"; text?: string; format?: TextFormatType[] }
  | { op: "heading"; level?: 1 | 2 | 3; text?: string; format?: TextFormatType[] }
  | { op: "table"; rows: string[][]; header?: boolean };

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

function appendText(
  parent: ElementNode,
  text: string,
  format?: TextFormatType[]
): void {
  const node = $createTextNode(text);
  for (const f of format ?? []) node.toggleFormat(f);
  parent.append(node);
}

function applyOp(op: ContentOp): void {
  const root = $getRoot();
  switch (op.op) {
    case "clear":
      root.clear();
      break;
    case "paragraph": {
      const p = $createParagraphNode();
      if (op.text) appendText(p, op.text, op.format);
      root.append(p);
      break;
    }
    case "heading": {
      const h = $createHeadingNode(`h${op.level ?? 1}` as HeadingTagType);
      if (op.text) appendText(h, op.text, op.format);
      root.append(h);
      break;
    }
    case "table": {
      const table = $createTableNode();
      op.rows.forEach((row, r) => {
        const tr = $createTableRowNode();
        for (const cellText of row) {
          const header = op.header && r === 0;
          const cell = $createTableCellNode(
            header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS
          );
          const p = $createParagraphNode();
          appendText(p, cellText ?? "");
          cell.append(p);
          tr.append(cell);
        }
        table.append(tr);
      });
      root.append(table);
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
  binding.root.getSharedType().observeDeep((events, tx) => {
    if (tx.origin !== binding) {
      syncYjsChangesToLexical(binding, provider, events, false);
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
      for (const op of ops) applyOp(op);
    },
    { discrete: true }
  );

  const delta = Y.encodeStateAsUpdate(doc, beforeSV);
  log.debug(`built ${ops.length} op(s) → ${delta.byteLength}B delta`);
  return delta;
}
