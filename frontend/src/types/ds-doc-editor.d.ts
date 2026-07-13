declare module '@toddle-edu/ds-doc-editor' {
  import type { ComponentType } from 'react';

  // Yjs Y.Doc (opaque here — re-exported from the editor's bundled yjs).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type YDoc = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Provider = any;

  // Real-time collaboration config (Lexical @lexical/yjs CollaborationPlugin).
  export interface DocEditorCollab {
    /** Room / document id — must equal the rtc-token's docId. */
    id: string;
    /** Returns a Yjs provider for the room; the plugin connects it. */
    providerFactory: (id: string, yjsDocMap: Map<string, YDoc>) => Provider;
    username?: string;
    cursorColor?: string;
    /** Seed an empty doc with the editor's initial state (safe; only when empty). */
    shouldBootstrap?: boolean;
    content?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    awarenessData?: Record<string, any>;
  }

  export interface DocEditorProps {
    content?: string;
    onChange?: (html: string, isEmpty?: boolean) => void;
    viewOnly?: boolean;
    placeholder?: string;
    collab?: DocEditorCollab;
    // The bundle accepts more props than documented; stay permissive.
    [key: string]: unknown;
  }

  export const DocEditor: ComponentType<DocEditorProps>;
  export const MiniDocEditor: ComponentType<DocEditorProps>;

  // Re-exported from the editor's own bundled yjs + y-websocket (version-matched,
  // so the provider's Y.Doc is the same Yjs the editor binds to).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Y: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const WebsocketProvider: any;
  export function isClean(html: string): boolean;

  // Serialize a stored Lexical editorState JSON to clean HTML (via each node's exportDOM) + plain text.
  export function editorStateJsonToHtml(
    editorStateJson: unknown,
  ): { html: string; text: string };
}
