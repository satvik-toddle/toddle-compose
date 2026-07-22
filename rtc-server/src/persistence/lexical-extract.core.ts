import { $getRoot } from "lexical";
import { bindAndApply } from "./lexical-binding.core";
import { createLogger } from "../logger";

const log = createLogger("extract");

export type ExtractResult = { lexicalJson: string | null; plainText: string };

// Synchronous, CPU-heavy headless-Lexical extraction; main-thread callers use LexicalExtractService's worker pool instead.
export function extractFromBytesSync(stateUpdate: Uint8Array): ExtractResult {
  const t0 = Date.now();
  try {
    const { editor } = bindAndApply(stateUpdate, {
      onError: (err) => log.error("headless editor error", err),
      onSyncError: (e) =>
        log.warn(`sync Y->L failed: ${e instanceof Error ? e.message : e}`),
    });

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
