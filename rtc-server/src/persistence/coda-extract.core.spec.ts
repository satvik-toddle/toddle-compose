import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncLexicalUpdateToYjs,
  type Provider,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type Klass,
  type LexicalNode,
} from "lexical";
import { $createTableNodeWithDimensions } from "@lexical/table";
import { extractCodaHtmlSync } from "./coda-extract.core";

const NAMESPACE = "ds-doc-editor-collab";
const serverNodes: Array<Klass<LexicalNode>> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime CJS bundle, not a typed module
  require("../../vendor/server-nodes.cjs").AllDocEditorNodes;

// Build collab Yjs bytes by seeding a headless editor and syncing its updates into the Y.Doc,
// mirroring how a real doc gets persisted. `text` empty => a doc with only an empty paragraph.
function docBytes(text: string): Uint8Array {
  const ydoc = new Y.Doc();
  const editor = createHeadlessEditor({
    namespace: NAMESPACE,
    nodes: serverNodes,
    onError: () => {},
  });
  const provider = {
    awareness: new Awareness(ydoc),
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as unknown as Provider;
  const binding = createBinding(
    editor,
    provider,
    NAMESPACE,
    ydoc,
    new Map<string, Y.Doc>([[NAMESPACE, ydoc]])
  );
  editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyElements,
      dirtyLeaves,
      normalizedNodes,
      tags,
    }) => {
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
  editor.update(
    () => {
      const p = $createParagraphNode();
      if (text) p.append($createTextNode(text));
      $getRoot().append(p);
    },
    { discrete: true }
  );
  return Y.encodeStateAsUpdate(ydoc);
}

// A Yjs XML element node's shared type as used by @lexical/yjs (element = Y.XmlText embed).
type YElem = {
  getAttribute: (k: string) => unknown;
  setAttribute: (k: string, v: unknown) => void;
  toDelta: () => { insert: unknown }[];
  insertEmbed: (index: number, embed: unknown) => void;
  insert: (index: number, text: string) => void;
};

// Child element shared types of `xt` whose __type matches.
function childElems(xt: YElem, type: string): YElem[] {
  const out: YElem[] = [];
  for (const op of xt.toDelta()) {
    const c = op.insert as Partial<YElem>;
    if (c && typeof c.getAttribute === "function" && c.getAttribute("__type") === type)
      out.push(c as YElem);
  }
  return out;
}

// Depth-first search for the first element shared type with __type === "table".
function findTableElem(xt: YElem): YElem | undefined {
  for (const op of xt.toDelta()) {
    const c = op.insert as Partial<YElem>;
    if (c && typeof c.getAttribute === "function") {
      if (c.getAttribute("__type") === "table") return c as YElem;
      if (typeof c.toDelta === "function") {
        const found = findTableElem(c as YElem);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// Author a paragraph + text child directly in a cell's Yjs shared type (mirrors how @lexical/yjs
// appends: XmlText embed for the paragraph, a Y.Map text-node embed, then the text string).
function injectCellText(cellXml: YElem, text: string): void {
  const pXml = new Y.XmlText();
  pXml.setAttribute("__type", "paragraph");
  cellXml.insertEmbed(0, pXml);
  const tMap = new Y.Map();
  tMap.set("__type", "text");
  (pXml as unknown as YElem).insertEmbed(0, tMap);
  (pXml as unknown as YElem).insert(1, text);
}

// Build collab bytes for a 2x3 table, then simulate the 0.48 client by authoring cell content AND
// writing __colWidths onto the table's Yjs shared type (the 0.45 TableNode class has neither the
// property nor a working server-side cell-content writer, so both can only arrive via Yjs).
function tableDocBytesWithColWidths(colWidths: number[]): Uint8Array {
  const ydoc = new Y.Doc();
  const editor = createHeadlessEditor({
    namespace: NAMESPACE,
    nodes: serverNodes,
    onError: () => {},
  });
  const provider = {
    awareness: new Awareness(ydoc),
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as unknown as Provider;
  const binding = createBinding(
    editor,
    provider,
    NAMESPACE,
    ydoc,
    new Map<string, Y.Doc>([[NAMESPACE, ydoc]])
  );
  editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyElements,
      dirtyLeaves,
      normalizedNodes,
      tags,
    }) => {
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
  editor.update(
    () => {
      $getRoot().append($createTableNodeWithDimensions(2, 3, false));
    },
    { discrete: true }
  );

  const tableElem = findTableElem(
    binding.root.getSharedType() as unknown as YElem
  );
  if (!tableElem) throw new Error("table shared type not found in Y.Doc");
  tableElem.setAttribute("__colWidths", colWidths);
  childElems(tableElem, "tablerow").forEach((row, ri) => {
    childElems(row, "custom-table-cell").forEach((cell, ci) => {
      injectCellText(cell, `r${ri}c${ci}`);
    });
  });
  return Y.encodeStateAsUpdate(ydoc);
}

describe("extractCodaHtmlSync", () => {
  it("a doc with real text extracts non-empty (happy path, no throw)", () => {
    const res = extractCodaHtmlSync(docBytes("hello coda"));
    expect(res.isEmpty).toBe(false);
    expect(res.text).toContain("hello coda");
  });

  it("a genuinely empty doc returns isEmpty:true (a real result, not a failure)", () => {
    const res = extractCodaHtmlSync(docBytes(""));
    expect(res.isEmpty).toBe(true);
  });

  it("throws on extraction failure so the caller fails closed (never coerces to isEmpty)", () => {
    // Malformed Yjs update: decoding reads a bogus length and runs past the buffer.
    const garbage = new Uint8Array([255, 255, 255, 255, 255, 255]);
    expect(() => extractCodaHtmlSync(garbage)).toThrow(/coda extraction failed/);
  });

  it("recovers __colWidths from Yjs and emits them as an empty <thead> (end-to-end)", () => {
    const res = extractCodaHtmlSync(tableDocBytesWithColWidths([400, 100, 200]));
    expect(res.html).toContain("<thead>");
    expect(res.html).toContain('<th style="width: 400px"></th>');
    expect(res.html).toContain('<th style="width: 100px"></th>');
    expect(res.html).toContain('<th style="width: 200px"></th>');
    expect(res.html).toContain("r0c0");
    expect(res.html).toContain("r1c2");
  });
});
