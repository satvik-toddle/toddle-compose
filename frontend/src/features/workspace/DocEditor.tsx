import { useMemo } from 'react';
import { DocEditor as DsDocEditor, WebsocketProvider, Y } from '@toddle-edu/ds-doc-editor';
// The editor's styles (self-contained — bundles its own antd layer).
import '@toddle-edu/ds-doc-editor/dist/main.css';
import { useRtcToken } from '../../hooks/usePages';
import { useAuthStore } from '../../stores/authStore';
import { PageSpinner } from '../../components/Spinner';
import { RTC_WS_URL } from '../../lib/env';

// Real-time collaborative editor. Mints an RTC token, then hands ds-doc-editor a
// `collab` config whose providerFactory opens a Yjs Websocket to the rtc-server
// (room = docId). The body lives in Yjs (rtc-database) — multi-user, live, server
// persistence. Keyed by docId at the call site → remounts per document.
export function DocEditor({ docId }: { docId: string; canEdit?: boolean }) {
  const me = useAuthStore((s) => s.user);
  const { data: rtc, isLoading, isError } = useRtcToken(docId);

  const collab = useMemo(() => {
    if (!rtc) return null;
    const token = rtc.token;
    return {
      id: docId, // room name; must equal the token's docId
      providerFactory: (id: string, yjsDocMap: Map<string, unknown>) => {
        let doc = yjsDocMap.get(id) as InstanceType<typeof Y.Doc> | undefined;
        if (!doc) {
          doc = new Y.Doc();
          yjsDocMap.set(id, doc);
        }
        // The CollaborationPlugin connects/disconnects the provider.
        return new WebsocketProvider(RTC_WS_URL, id, doc, {
          params: { token },
          connect: false,
        });
      },
      username: me?.name ?? 'User',
      cursorColor: me?.color ?? '#5a5ae2',
      shouldBootstrap: true,
    };
  }, [docId, rtc, me]);

  if (isError) {
    return (
      <div className="tc-editor tc-center" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        Couldn't open this document for editing.
      </div>
    );
  }
  if (isLoading || !rtc || !collab) {
    return (
      <div className="tc-editor">
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className="tc-editor">
      <DsDocEditor
        collab={collab}
        viewOnly={rtc.role !== 'editor'}
        placeholder={rtc.role === 'editor' ? 'Start writing…' : 'This document is empty.'}
      />
    </div>
  );
}
