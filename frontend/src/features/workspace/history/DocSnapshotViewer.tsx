import { useMemo } from 'react';
import { DocEditor as DsDocEditor, Y } from '@toddle-edu/ds-doc-editor';
import '@toddle-edu/ds-doc-editor/dist/main.css';
import s from '../DocEditor.module.scss';
import { EDITOR_CONFIG, EDITOR_STYLES } from '../DocEditor';
import { OfflineProvider } from './offlineProvider';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type DocSnapshotViewerProps = {
  docId: string;
  // Full Yjs state at this seq (base64); empty/undefined = empty doc.
  yjsStateB64?: string;
};

// Renders a DOC at a past seq: a fresh Y.Doc hydrated from the snapshot via a no-network OfflineProvider, through ds-doc-editor's collab path — byte-identical to live, view-only, keyed by seq to remount per version.
export function DocSnapshotViewer({ docId, yjsStateB64 }: Readonly<DocSnapshotViewerProps>) {
  const collab = useMemo(() => {
    const update = yjsStateB64 ? base64ToBytes(yjsStateB64) : null;
    return {
      // MUST equal the live docId: @lexical/yjs keys the shared root by this id, matching the snapshot's stored root.
      id: docId,
      providerFactory: (id: string, yjsDocMap: Map<string, unknown>) => {
        // Lexical's yjsDocMap is a module singleton, so discard any stale entry and bind a fresh doc.
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
  }, [docId, yjsStateB64]);

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
