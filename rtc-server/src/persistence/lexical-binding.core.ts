import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncYjsChangesToLexical,
  type Provider,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import type { Klass, LexicalNode, LexicalEditor } from "lexical";

export const NAMESPACE = "ds-doc-editor-collab";

// Pre-bundled CJS (lexical/yjs externalized) so nodes share the loading context's single lexical/yjs instances. See scripts/bundle-server-nodes.mjs.
export const serverNodes: Array<Klass<LexicalNode>> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime CJS bundle, not a typed module
  require("../../vendor/server-nodes.cjs").AllDocEditorNodes;

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

// Create a headless editor bound to a fresh Y.Doc, apply the Yjs update, and flush the binding into
// the Lexical editor state. Callers differ only in how they log headless-editor errors (onError) and
// partial Y->L sync failures (onSyncError), so both are injected to preserve each caller's semantics.
export function bindAndApply(
  stateUpdate: Uint8Array,
  opts: {
    onError: (err: Error) => void;
    onSyncError: (err: unknown) => void;
  }
): { editor: LexicalEditor; ydoc: Y.Doc } {
  const ydoc = new Y.Doc();
  const editor = createHeadlessEditor({
    namespace: NAMESPACE,
    nodes: serverNodes,
    onError: opts.onError,
  });
  const docMap = new Map<string, Y.Doc>([[NAMESPACE, ydoc]]);
  const provider = makeStubProvider(ydoc);
  const binding = createBinding(editor, provider, NAMESPACE, ydoc, docMap);
  binding.root.getSharedType().observeDeep((events) => {
    try {
      syncYjsChangesToLexical(binding, provider, events, false);
    } catch (e) {
      opts.onSyncError(e);
    }
  });
  Y.applyUpdate(ydoc, stateUpdate);
  editor.update(() => {}, { discrete: true });
  return { editor, ydoc };
}
