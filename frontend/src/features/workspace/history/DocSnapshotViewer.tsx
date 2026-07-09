import { DocEditor as DsDocEditor } from '@toddle-edu/ds-doc-editor';
import '@toddle-edu/ds-doc-editor/dist/main.css';
import s from '../DocEditor.module.scss';
import { EDITOR_CONFIG, EDITOR_STYLES } from '../DocEditor';

type DocSnapshotViewerProps = {
  // Server-extracted Lexical editorState (plain snapshot or merged diff), upload URLs already materialized.
  editorStateJson: string;
};

// Renders a DOC version (or version diff) from server-provided editorState JSON through the
// no-collab read-only path — no Y.Doc, no provider, no upload-registry binding needed.
// Keyed by seq/diff at the call site to remount per version.
export function DocSnapshotViewer({ editorStateJson }: Readonly<DocSnapshotViewerProps>) {
  return (
    <div className={s.tcEditor}>
      <DsDocEditor
        viewOnly
        placeholder="This version is empty."
        config={EDITOR_CONFIG}
        initialConfig={{ editorState: editorStateJson }}
        minHeight={0}
        styles={EDITOR_STYLES}
      />
    </div>
  );
}
