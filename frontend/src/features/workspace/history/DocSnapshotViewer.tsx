import { useMemo } from 'react';
import { DocEditor as DsDocEditor, Y } from '@toddle-edu/ds-doc-editor';
import '@toddle-edu/ds-doc-editor/dist/main.css';
import s from '../DocEditor.module.scss';
import { OfflineProvider } from './offlineProvider';

// Mirror the live DocEditor's chrome so a snapshot reads identically (no toolbar,
// full-width readable column) — only it's static and read-only.
const EDITOR_CONFIG = { toolbar: { enabled: false } };
const EDITOR_STYLES = {
  scrollableContainer: { height: '100%', background: 'var(--panel-bg)' },
  anchorElement: { width: '100%', maxWidth: '100%' },
  contentBgProvider: { minHeight: '100%', padding: '0 48px 80px', background: 'var(--panel-bg)' },
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type DocSnapshotViewerProps = {
  docId: string;
  seq: number;
  // Full Yjs state at this seq (base64); empty/undefined = empty doc.
  yjsStateB64?: string;
};

// Renders a DOC at a past update seq. Binds a fresh Y.Doc — hydrated from the
// snapshot's Yjs state via a no-network OfflineProvider — through ds-doc-editor's
// collaborative render path, so the historical view is byte-identical to the live
// editor, permanently view-only. Keyed by seq at the call site → remounts per version.
export function DocSnapshotViewer({ docId, seq, yjsStateB64 }: Readonly<DocSnapshotViewerProps>) {
  const collab = useMemo(() => {
    const update = yjsStateB64 ? base64ToBytes(yjsStateB64) : null;
    return {
      // MUST equal the live docId: @lexical/yjs keys the shared root by this id,
      // and the snapshot's Yjs state stores the root under the real docId.
      id: docId,
      providerFactory: (id: string, yjsDocMap: Map<string, unknown>) => {
        // The live editor is unmounted in history mode, but Lexical's yjsDocMap is
        // a module singleton — discard any stale entry and bind a fresh doc.
        const existing = yjsDocMap.get(id) as InstanceType<typeof Y.Doc> | undefined;
        if (existing) {
          existing.destroy();
          yjsDocMap.delete(id);
        }
        const doc = new Y.Doc();
        yjsDocMap.set(id, doc);
        return new OfflineProvider(doc, update);
      },
      // The doc is delivered pre-populated, so no empty-doc bootstrap is needed.
      shouldBootstrap: false,
      username: 'History',
      cursorColor: '#5a5ae2',
    };
  }, [docId, seq, yjsStateB64]);

  return (
    <div className={s.tcEditor}>
      <DsDocEditor
        collab={collab}
        viewOnly
        placeholder="This version is empty."
        config={EDITOR_CONFIG}
        minHeight={0}
        styles={EDITOR_STYLES}
      />
    </div>
  );
}
