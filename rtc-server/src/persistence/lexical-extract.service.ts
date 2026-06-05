import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncYjsChangesToLexical,
  type Provider,
} from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import { $getRoot, type Klass, type LexicalNode } from "lexical";
import { createLogger } from "../logger";

const log = createLogger("extract");
const NAMESPACE = "ds-doc-editor-collab";

// Server node classes are pre-bundled to CJS (lexical/yjs externalized) so they
// share this process's single lexical/yjs instances. See scripts/bundle-server-nodes.mjs.

const serverNodes: Array<Klass<LexicalNode>> =
  require("../../vendor/server-nodes.cjs").AllDocEditorNodes;

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

@Injectable()
export class LexicalExtractService {
  extractFromBytes(stateUpdate: Uint8Array): {
    lexicalJson: string | null;
    plainText: string;
  } {
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
      const binding = createBinding(editor, provider, NAMESPACE, tmpDoc, docMap);

      binding.root.getSharedType().observeDeep((events) => {
        try {
          syncYjsChangesToLexical(binding, provider, events, false);
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
}
