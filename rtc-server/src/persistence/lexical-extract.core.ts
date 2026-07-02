import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import { createBinding, syncYjsChangesToLexical } from "@lexical/yjs";
import { $getRoot } from "lexical";
import {
  NAMESPACE,
  excludedProperties,
  makeStubProvider,
  serverNodes,
  withBenignYjsSilenced,
} from "../lexical-headless";
import { createLogger } from "../logger";

const log = createLogger("extract");

export type ExtractResult = { lexicalJson: string | null; plainText: string };

// Synchronous, CPU-heavy headless-Lexical extraction; main-thread callers use LexicalExtractService's worker pool instead.
export function extractFromBytesSync(stateUpdate: Uint8Array): ExtractResult {
  const t0 = Date.now();
  try {
    const tmpDoc = new Y.Doc();
    const editor = createHeadlessEditor({
      namespace: NAMESPACE,
      nodes: serverNodes,
      onError: (err) => log.error("headless editor error", err),
    });
    const docMap = new Map<string, Y.Doc>([[NAMESPACE, tmpDoc]]);
    const provider = makeStubProvider(tmpDoc);
    // Same excludedProperties as content-builder: without it, table-cell array props break the XML-attr sync on read.
    const binding = createBinding(
      editor,
      provider,
      NAMESPACE,
      tmpDoc,
      docMap,
      excludedProperties
    );

    binding.root.getSharedType().observeDeep((events) => {
      try {
        withBenignYjsSilenced(() =>
          syncYjsChangesToLexical(binding, provider, events, false)
        );
      } catch (e) {
        log.warn(`sync Y->L failed: ${e instanceof Error ? e.message : e}`);
      }
    });

    Y.applyUpdate(tmpDoc, stateUpdate);
    editor.update(() => {}, { discrete: true });

    const editorState = editor.getEditorState();
    const lexicalJson = JSON.stringify(editorState.toJSON());
    let plainText = "";
    editorState.read(() => {
      plainText = $getRoot().getTextContent();
    });

    log.debug(
      `extract OK json=${lexicalJson.length}B text=${plainText.length}ch in ${Date.now() - t0}ms`
    );
    return { lexicalJson, plainText };
  } catch (e) {
    log.warn(
      `headless extraction FAILED in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : e}`
    );
    return { lexicalJson: null, plainText: "" };
  }
}
