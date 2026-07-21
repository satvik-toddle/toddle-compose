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
});
