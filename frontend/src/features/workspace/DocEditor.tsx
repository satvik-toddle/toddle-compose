import { useEffect, useRef } from 'react';
import { DocEditor as DsDocEditor } from '@toddle-edu/ds-doc-editor';
// The editor's styles (self-contained — bundles its own antd layer).
import '@toddle-edu/ds-doc-editor/dist/main.css';
import { useDocumentBody, useSaveDocumentBody } from '../../hooks/usePages';
import { PageSpinner } from '../../components/Spinner';

// Wraps @toddle-edu/ds-doc-editor (single-user). Loads the HTML body from the
// server and saves edits back via the REST body endpoint, so the same doc shows
// the same content for every user who opens it (shared, but not live — that's
// the RTC/Yjs swap). Loads via the `content` prop; captures edits straight from
// the editor's contenteditable (its public onChange is opaque in the bundle).
// Keyed by docId at the call site → remounts per doc.
export function DocEditor({ docId, canEdit }: { docId: string; canEdit: boolean }) {
  const { data, isLoading } = useDocumentBody(docId);
  const save = useSaveDocumentBody();
  const wrapRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  // Hold the latest mutate so the listener effect needn't re-run on each save.
  const mutateRef = useRef(save.mutate);
  mutateRef.current = save.mutate;

  useEffect(() => {
    if (!canEdit || isLoading) return;
    const root = wrapRef.current;
    if (!root) return;
    let ce: HTMLElement | null = null;

    const onInput = () => {
      if (!ce) return;
      const html = ce.innerHTML;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        mutateRef.current({ id: docId, body: html });
      }, 700);
    };

    // The contenteditable mounts asynchronously — poll briefly for it.
    let tries = 0;
    let raf = 0;
    const attach = () => {
      ce = root.querySelector<HTMLElement>('[contenteditable="true"]');
      if (ce) {
        ce.addEventListener('input', onInput);
        return;
      }
      if (tries++ < 50) raf = window.setTimeout(attach, 100);
    };
    attach();

    return () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(raf);
      if (ce) ce.removeEventListener('input', onInput);
    };
  }, [docId, canEdit, isLoading]);

  return (
    <div className="tc-editor" ref={wrapRef}>
      {isLoading ? (
        <PageSpinner />
      ) : (
        <DsDocEditor
          content={data?.body ?? ''}
          viewOnly={!canEdit}
          placeholder={canEdit ? 'Start writing…' : 'This document is empty.'}
        />
      )}
    </div>
  );
}
