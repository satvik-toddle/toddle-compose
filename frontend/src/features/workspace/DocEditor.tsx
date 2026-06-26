import { useMemo, useRef } from 'react';
import { DocEditor as DsDocEditor, WebsocketProvider, Y } from '@toddle-edu/ds-doc-editor';
// The editor's styles (self-contained — bundles its own antd layer).
import '@toddle-edu/ds-doc-editor/dist/main.css';
import { useRtcToken } from '../../hooks/usePages';
import { useAuthStore } from '../../stores/authStore';
import { PageLoader } from '../../components/Loader';
import { RTC_WS_URL } from '../../lib/env';
import s from './DocEditor.module.scss';

// Hide the editor's built-in top toolbar — formatting comes from the floating
// selection toolbar + slash menu (Coda-style). The editable surface then fills
// the full width and height of the page pane (no centered 800px column).
const EDITOR_CONFIG = { toolbar: { enabled: false } };
const EDITOR_STYLES = {
  scrollableContainer: { height: '100%', background: 'var(--panel-bg)' },
  anchorElement: { width: '100%', maxWidth: '100%' },
  contentBgProvider: { minHeight: '100%', padding: '0 48px 80px', background: 'var(--panel-bg)' },
};

// Real-time collaborative editor. Mints an RTC token, then hands ds-doc-editor a
// `collab` config whose providerFactory opens a Yjs Websocket to the rtc-server
// (room = docId). The body lives in Yjs (rtc-database) — multi-user, live, server
// persistence. Keyed by docId at the call site → remounts per document.
export function DocEditor({ docId }: { docId: string; canEdit?: boolean }) {
  const me = useAuthStore((s) => s.user);
  const { data: rtc, isLoading, isError } = useRtcToken(docId);

  // Read the token via a ref so a token refetch (refetchOnWindowFocus past staleTime) doesn't recreate the collab/providerFactory and tear down the live Y.Doc mid-session.
  const tokenRef = useRef<string | undefined>(rtc?.token);
  tokenRef.current = rtc?.token;
  // True once this mount has bound its own fresh Y.Doc — distinguishes a genuine remount (stale doc from a prior mount → discard) from a same-mount re-invocation (live session → reuse, never destroy).
  const boundRef = useRef(false);

  const collab = useMemo(() => {
    return {
      id: docId, // room name; must equal the token's docId
      providerFactory: (id: string, yjsDocMap: Map<string, unknown>) => {
        let doc = yjsDocMap.get(id) as InstanceType<typeof Y.Doc> | undefined;
        // Only the first bind of a mount discards a doc: it's the stale one left in Lexical's singleton map by a prior mount, and reusing it renders blank (server sync emits no new changes).
        if (doc && !boundRef.current) {
          doc.destroy();
          yjsDocMap.delete(id);
          doc = undefined;
        }
        if (!doc) {
          doc = new Y.Doc();
          yjsDocMap.set(id, doc);
        }
        boundRef.current = true;
        // The CollaborationPlugin connects/disconnects the provider.
        return new WebsocketProvider(RTC_WS_URL, id, doc, {
          params: { token: tokenRef.current },
          connect: false,
        });
      },
      username: me?.name ?? 'User',
      cursorColor: me?.color ?? '#5a5ae2',
      shouldBootstrap: true,
    };
  }, [docId, me]);

  if (isError) {
    return (
      <div className={`${s.tcEditor} tc-center`} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        Couldn't open this document for editing.
      </div>
    );
  }
  if (isLoading || !rtc || !collab) {
    return (
      <div className={s.tcEditor}>
        <PageLoader />
      </div>
    );
  }

  return (
    <div className={s.tcEditor}>
      <DsDocEditor
        collab={collab}
        viewOnly={rtc.role !== 'editor'}
        placeholder={rtc.role === 'editor' ? 'Start writing…' : 'This document is empty.'}
        config={EDITOR_CONFIG}
        minHeight={0}
        styles={EDITOR_STYLES}
      />
    </div>
  );
}
