import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { Provider } from "@lexical/yjs";
import type { Klass, LexicalNode } from "lexical";

// Shared headless Lexical↔Yjs bootstrap for content-builder and lexical-extract, so the namespace, node set, and binding workarounds can't drift between the write and read paths.

// Must match the editor's collaboration namespace (the Yjs root key).
export const NAMESPACE = "ds-doc-editor-collab";

// Pre-bundled CJS (lexical/yjs externalized) so nodes share the loading context's single lexical/yjs instances. See scripts/bundle-server-nodes.mjs.
export const serverNodes: Array<Klass<LexicalNode>> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime CJS bundle, not a typed module
  require("../vendor/server-nodes.cjs").AllDocEditorNodes;

// Custom table cell's array/object props (border types/colors) break yjs XML-attr sync; exclude them, constructor re-applies defaults.
export const excludedProperties: Map<Klass<LexicalNode>, Set<string>> = (() => {
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

export function makeStubProvider(ydoc: Y.Doc): Provider {
  const awareness = new Awareness(ydoc);
  return {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as unknown as Provider;
}

const BENIGN = "Add Yjs type to a document before reading data";

// Scoped (not process-global) suppression of the one benign warning yjs prints when the headless Y→L observers transiently read the shared type mid state-integration; anywhere else the warning stays visible since it can signal real premature-access bugs.
export function withBenignYjsSilenced<T>(fn: () => T): T {
  const patched = (["error", "warn", "log"] as const).map((ch) => {
    const orig = console[ch];
    console[ch] = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(BENIGN)) return;
      orig.apply(console, args);
    };
    return [ch, orig] as const;
  });
  try {
    return fn();
  } finally {
    for (const [ch, orig] of patched) console[ch] = orig;
  }
}
