import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncYjsChangesToLexical,
  type Provider,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import { $getRoot, type Klass, type LexicalNode } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import { JSDOM } from "jsdom";
import { sanitizeConstrainedHtml } from "./coda-html-sanitizer";
import { createLogger } from "../logger";

const log = createLogger("coda-extract");
const NAMESPACE = "ds-doc-editor-collab";
// Sibling Yjs map holding uploadId -> { url } (doc-editor's UploadRegistry); outside the Lexical tree.
const UPLOAD_REGISTRY_KEY = "tde-upload-registry";

// Same 0.45.0 node bundle the JSON extractor uses (see scripts/bundle-server-nodes.mjs); its exportDOMs
// drive the HTML. rtc-server's own @lexical/html matches this bundle's lexical version.
const serverNodes: Array<Klass<LexicalNode>> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime CJS bundle, not a typed module
  require("../../vendor/server-nodes.cjs").AllDocEditorNodes;

export type CodaExtractResult = { html: string; text: string; isEmpty: boolean };

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
// exportDOM -> constrained/sanitized HTML. Never throws; failures return isEmpty so the caller skips.
export function extractCodaHtmlSync(stateUpdate: Uint8Array): CodaExtractResult {
  const t0 = Date.now();
  try {
    ensureDomGlobals();
    const tmpDoc = new Y.Doc();
    const editor = createHeadlessEditor({
      namespace: NAMESPACE,
      nodes: serverNodes,
      onError: (err) => log.warn(`headless editor error: ${String(err)}`),
    });
    const docMap = new Map<string, Y.Doc>([[NAMESPACE, tmpDoc]]);
    const provider = makeStubProvider(tmpDoc);
    const binding = createBinding(editor, provider, NAMESPACE, tmpDoc, docMap);
    binding.root.getSharedType().observeDeep((events) => {
      try {
        syncYjsChangesToLexical(binding, provider, events, false);
      } catch {
        // Best-effort snapshot render; ignore partial sync failures.
      }
    });
    Y.applyUpdate(tmpDoc, stateUpdate);
    editor.update(() => {}, { discrete: true });

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

    const html = sanitizeConstrainedHtml(rawHtml);
    const isEmpty = !hasContent(html, text);
    log.debug(
      `coda extract OK html=${html.length}B text=${text.length}ch empty=${isEmpty} in ${Date.now() - t0}ms`
    );
    return { html, text, isEmpty };
  } catch (e) {
    log.warn(
      `coda extract FAILED in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : e}`
    );
    return { html: "", text: "", isEmpty: true };
  }
}
