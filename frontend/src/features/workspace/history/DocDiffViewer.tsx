import { useMemo } from 'react';
import { DocEditor as DsDocEditor, bytesToEditorStateJSON } from '@toddle-edu/ds-doc-editor';
import '@toddle-edu/ds-doc-editor/dist/main.css';
import s from '../DocEditor.module.scss';
import { EDITOR_CONFIG, EDITOR_STYLES } from '../DocEditor';
import { diffEditorStates, type SerializedEditorState } from './docDiff';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// An empty document, used as the "before" when comparing the oldest version (everything then reads as added).
const EMPTY_STATE: SerializedEditorState = { root: { type: 'root', children: [] } };

// Turn a snapshot's Yjs bytes into a native-0.45 Lexical editorState via the editor package's own bundled lexical; empty/absent bytes → empty doc.
function stateFromB64(b64: string | undefined): SerializedEditorState | null {
  if (!b64) return EMPTY_STATE;
  const json = bytesToEditorStateJSON(base64ToBytes(b64));
  return json ? (json as SerializedEditorState) : null;
}

type DocDiffViewerProps = {
  // Full Yjs state (base64) of the previous version (the diff baseline) and the selected version.
  beforeStateB64?: string;
  afterStateB64?: string;
};

// Renders version N against N-1: extracts both editorStates, computes one merged editorState (adds tinted green, removes re-inserted red via diff-mark nodes), and renders it read-only through the editor's no-collab path — DiffMarkNode ships in AllDocEditorNodes and its CSS in the package stylesheet.
export function DocDiffViewer({ beforeStateB64, afterStateB64 }: Readonly<DocDiffViewerProps>) {
  const editorState = useMemo(() => {
    const after = stateFromB64(afterStateB64);
    // A null after means extraction failed; without it there is nothing to render.
    if (!after) return null;
    const before = stateFromB64(beforeStateB64) ?? EMPTY_STATE;
    return JSON.stringify(diffEditorStates(before, after));
  }, [beforeStateB64, afterStateB64]);

  if (!editorState) {
    return (
      <div className={`${s.tcEditor} tc-center`} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        Couldn&apos;t render this comparison.
      </div>
    );
  }

  return (
    <div className={s.tcEditor}>
      <DsDocEditor
        viewOnly
        placeholder="No changes in this version."
        config={EDITOR_CONFIG}
        initialConfig={{ editorState }}
        minHeight={0}
        styles={EDITOR_STYLES}
      />
    </div>
  );
}
