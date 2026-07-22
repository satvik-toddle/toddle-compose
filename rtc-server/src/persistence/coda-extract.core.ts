import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor, type LexicalNode } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import { JSDOM } from "jsdom";
import { bindAndApply, serverNodes } from "./lexical-binding.core";
import { sanitizeConstrainedHtml } from "./coda-html-sanitizer";
import { createLogger } from "../logger";

const log = createLogger("coda-extract");
// Sibling Yjs map holding uploadId -> { url } (doc-editor's UploadRegistry); outside the Lexical tree.
const UPLOAD_REGISTRY_KEY = "tde-upload-registry";

export type CodaExtractResult = { html: string; text: string; isEmpty: boolean };

// Bake registry-resolved upload URLs into node JSON so the HTML editor (no Y.Doc attached) emits a
// real src instead of an empty one (mirrors doc-editor materializeUploadSrcs).
function materializeUploadSrcs(node: unknown, registry: Map<string, string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as { uploadId?: string; src?: string; children?: unknown[] };
  if (n.uploadId && !n.src) {
    const url = registry.get(n.uploadId);
    if (url) n.src = url;
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) materializeUploadSrcs(child, registry);
  }
}

// Validate a candidate __colWidths value: a non-empty array of finite positive numbers.
function validColWidths(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0))
    return undefined;
  return v as number[];
}

// Depth-first pre-order over the bound editor state; one entry per table node in document order.
// 0.45 exportJSON drops __colWidths, so widths are read here from the bound instances that @lexical/yjs
// populated (writableNode[property] = nextValue).
function collectTableColWidths(editor: LexicalEditor): (number[] | undefined)[] {
  const out: (number[] | undefined)[] = [];
  editor.getEditorState().read(() => {
    const visit = (node: LexicalNode): void => {
      if (node.getType() === "table") {
        out.push(validColWidths((node as { __colWidths?: unknown }).__colWidths));
      }
      const children = (node as { getChildren?: () => LexicalNode[] }).getChildren;
      if (typeof children === "function") {
        for (const child of children.call(node)) visit(child);
      }
    };
    visit($getRoot());
  });
  return out;
}

function readUploadRegistry(ydoc: Y.Doc): Map<string, string> {
  const out = new Map<string, string>();
  ydoc.getMap(UPLOAD_REGISTRY_KEY).forEach((value, key) => {
    const url = (value as { url?: string } | null)?.url;
    if (url) out.set(key, url);
  });
  return out;
}

// $generateHtmlFromNodes calls each node's exportDOM (document.createElement). Install jsdom globals
// once per worker; in a per-request worker this pollutes only that worker's throwaway globalThis.
let domInstalled = false;
function ensureDomGlobals(): void {
  if (domInstalled) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DocumentFragment = dom.window.DocumentFragment;
  g.HTMLElement = dom.window.HTMLElement;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  if (!g.navigator) g.navigator = dom.window.navigator;
  domInstalled = true;
}

// A doc with no rendered text still has content if it carries an image/link/table.
function hasContent(html: string, text: string): boolean {
  if (text.trim().length > 0) return true;
  return /<(img|a|table)\b/i.test(html);
}

// Full extraction for one doc: Yjs update -> editorState JSON (+ upload materialization) -> HTML via
// exportDOM -> constrained/sanitized HTML. Throws on failure so the caller can fail closed; a
// genuinely empty doc returns isEmpty:true (a real result, never confused with a failure).
export function extractCodaHtmlSync(stateUpdate: Uint8Array): CodaExtractResult {
  const t0 = Date.now();
  try {
    ensureDomGlobals();
    const { editor, ydoc: tmpDoc } = bindAndApply(stateUpdate, {
      onError: (err) => log.warn(`headless editor error: ${String(err)}`),
      // Best-effort snapshot render; ignore partial sync failures.
      onSyncError: () => {},
    });

    const tableColWidths = collectTableColWidths(editor);
    const json = editor.getEditorState().toJSON() as { root?: unknown };
    const registry = readUploadRegistry(tmpDoc);
    if (registry.size && json.root) materializeUploadSrcs(json.root, registry);

    // Re-parse the materialized JSON into a fresh editor so exportDOM sees the baked-in srcs.
    const htmlEditor = createHeadlessEditor({
      namespace: "ds-doc-editor-export",
      nodes: serverNodes,
      onError: () => {},
    });
    htmlEditor.setEditorState(htmlEditor.parseEditorState(JSON.stringify(json)));
    let rawHtml = "";
    let text = "";
    htmlEditor.read(() => {
      rawHtml = $generateHtmlFromNodes(htmlEditor);
      text = $getRoot().getTextContent();
    });

    const html = sanitizeConstrainedHtml(rawHtml, tableColWidths);
    const isEmpty = !hasContent(html, text);
    log.debug(
      `coda extract OK html=${html.length}B text=${text.length}ch empty=${isEmpty} in ${Date.now() - t0}ms`
    );
    return { html, text, isEmpty };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`coda extract FAILED in ${Date.now() - t0}ms: ${msg}`);
    throw new Error(`coda extraction failed: ${msg}`);
  }
}
