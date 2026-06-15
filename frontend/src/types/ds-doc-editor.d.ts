declare module '@toddle-edu/ds-doc-editor' {
  import type { ComponentType, ReactNode } from 'react';

  export interface DocEditorProps {
    /** Initial/controlled content (HTML). Setting it does not fire onChange. */
    content?: string;
    /** Emitted on edits: the serialized HTML (+ whether the doc is empty). */
    onChange?: (html: string, isEmpty?: boolean) => void;
    /** Read-only mode (viewers). */
    viewOnly?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    namespace?: string;
    children?: ReactNode;
    // The bundle accepts more props than are documented; stay permissive.
    [key: string]: unknown;
  }

  export const DocEditor: ComponentType<DocEditorProps>;
  export const MiniDocEditor: ComponentType<DocEditorProps>;
  export function isClean(html: string): boolean;
  export function createColors(...args: unknown[]): unknown;
}
