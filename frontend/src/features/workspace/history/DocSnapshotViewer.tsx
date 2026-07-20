import { useEffect, useRef } from 'react';
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
  const wrapRef = useRef<HTMLDivElement>(null);

  // The read-only editor's CommentPlugin preventDefaults Cmd/Ctrl+A in non-editable mode, so
  // native select-all is dead in history mode. It only preventDefaults (no stopPropagation), so
  // we re-enable it here: when the caret is inside this viewer, select the content ourselves.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      const content = wrap.querySelector('.ds-de-contentEditable');
      const sel = window.getSelection();
      if (!content || !sel || !sel.anchorNode || !content.contains(sel.anchorNode)) return;
      const range = document.createRange();
      range.selectNodeContents(content);
      sel.removeAllRanges();
      sel.addRange(range);
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={s.tcEditor} ref={wrapRef}>
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
