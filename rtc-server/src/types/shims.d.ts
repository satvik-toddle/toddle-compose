declare module "@toddle-edu/ds-doc-editor/server" {
  import type { Klass, LexicalNode } from "lexical";
  export const AllDocEditorNodes: Array<Klass<LexicalNode>>;
}

declare module "y-websocket/bin/utils" {
  import type { WebSocket } from "ws";
  import type { IncomingMessage } from "http";
  import type * as Y from "yjs";

  export function setupWSConnection(
    ws: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ): void;

  export function setPersistence(persistence: {
    bindState: (docName: string, ydoc: Y.Doc) => void | Promise<void>;
    writeState: (docName: string, ydoc: Y.Doc) => Promise<unknown>;
  }): void;

  export const docs: Map<
    string,
    Y.Doc & { conns: Map<WebSocket, Set<number>> }
  >;
}
