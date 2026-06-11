// @toddle-edu/ds-doc-editor ships no type definitions, so we declare the
// surface we use. Props are intentionally loose for now — we mount the editor
// without wiring props (see src/App.tsx). Tighten these as we adopt props.
declare module '@toddle-edu/ds-doc-editor' {
  import type { ComponentType } from 'react';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DocEditor: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const MiniDocEditor: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Editor: ComponentType<any>;
  // The editor re-exports its own bundled yjs + y-websocket so the host shares
  // a single yjs instance with the editor's collaboration plugin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Y: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const WebsocketProvider: any;
}
