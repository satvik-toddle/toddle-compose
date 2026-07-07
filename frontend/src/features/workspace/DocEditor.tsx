import { useMemo, useRef } from 'react';
import { DocEditor as DsDocEditor, WebsocketProvider, Y } from '@toddle-edu/ds-doc-editor';
// The editor's styles (self-contained — bundles its own antd layer).
import '@toddle-edu/ds-doc-editor/dist/main.css';
import { useRtcToken } from '../../hooks/usePages';
import { useShareLinkRtcToken } from '../../hooks/useShareLink';
import { uploadFile } from '../../api/uploads';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
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

// The editor calls this for every image/file insert (device upload, paste,
// drag-drop, and URL-add — which it re-fetches then re-uploads). It hands us
// either a bare File/Blob or an object `{ file, attachment }`; both must resolve
// to a fetchable URL it can use as the node src. Returns the stored object URL.
type UploadAttachment = { name?: string; mimeType?: string; metadata?: { fileExtension?: string } };
type UploadArg = File | Blob | { file: File | Blob; attachment?: UploadAttachment };

// Build a filename with an extension so the backend keys off the right type (URL-add gives an extension-less Blob + a mimeType).
function uploadName(file: File | Blob, attachment?: UploadAttachment): string | undefined {
  if (attachment?.name) return attachment.name;
  if (file instanceof File && file.name) return file.name;
  const ext = attachment?.metadata?.fileExtension ?? attachment?.mimeType?.split('/')[1] ?? file.type?.split('/')[1];
  return ext ? `upload.${ext}` : undefined;
}

async function uploadToServer(arg: UploadArg): Promise<string> {
  const file = arg instanceof Blob ? arg : arg?.file;
  if (!file) throw new Error('uploadToServer: no file provided');
  const attachment = arg instanceof Blob ? undefined : arg?.attachment;
  try {
    const stored = await uploadFile(file, uploadName(file, attachment));
    return stored.url;
  } catch (e) {
    // The editor swallows upload rejections silently, so surface the failure before rethrowing.
    pushToast({ kind: 'error', message: `Image upload failed: ${messageOf(e)}` });
    throw e;
  }
}

// Real-time collaborative editor. Mints an RTC token, then hands ds-doc-editor a
// `collab` config whose providerFactory opens a Yjs Websocket to the rtc-server
// (room = docId). The body lives in Yjs (rtc-database) — multi-user, live, server
// persistence. Keyed by docId at the call site → remounts per document.
// `shareToken` (public /link/:token view) mints the RTC token via the link instead of the
// authenticated doc endpoint; everything downstream (viewOnly, provider) is identical.
export function DocEditor({
  docId,
  shareToken,
  awarenessName,
  awarenessColor,
}: {
  docId: string;
  canEdit?: boolean;
  shareToken?: string;
  // Identity minted into a share-link RTC token (random guest name for logged-out viewers); takes precedence over the auth-store identity.
  awarenessName?: string;
  awarenessColor?: string;
}) {
  // Select primitive slices, not the user object: a token refresh replaces `user` by identity but leaves these values equal, so `collab` below stays stable instead of tearing down the live provider.
  const name = useAuthStore((s) => s.user?.name);
  const color = useAuthStore((s) => s.user?.color);
  // Exactly one source is enabled (the other is disabled via a falsy arg), so hooks stay unconditional.
  const docRtc = useRtcToken(shareToken ? undefined : docId);
  const linkRtc = useShareLinkRtcToken(shareToken);
  const { data: rtc, isLoading, isError, refetch } = shareToken ? linkRtc : docRtc;

  // Kept in a ref so providerFactory (built once, memoized) always calls the latest active query's refetch.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // One stable params object the provider keeps a reference to. y-websocket rebuilds the connection URL from `this.params` on every (re)connect, so mutating .token here keeps a long-lived session authing with a fresh token after a refetch (refetchOnWindowFocus past staleTime) — without recreating the provider and tearing down the live Y.Doc mid-session.
  const paramsRef = useRef<{ token?: string }>({});
  paramsRef.current.token = rtc?.token;
  // True once this mount has discarded the stale doc and bound a fresh Y.Doc; the call site remounts per docId (key={docId}) so one flag per mount suffices, and it also makes StrictMode's double providerFactory call reuse the fresh doc.
  const freshDocBoundRef = useRef(false);

  const collab = useMemo(() => {
    return {
      id: docId, // room name; must equal the token's docId
      providerFactory: (id: string, yjsDocMap: Map<string, unknown>) => {
        let doc = yjsDocMap.get(id) as InstanceType<typeof Y.Doc> | undefined;
        // First bind of this mount: any doc in Lexical's singleton map is stale from a prior mount/doc and reusing it renders blank (server sync emits no new changes) — discard it.
        if (doc && !freshDocBoundRef.current) {
          doc.destroy();
          yjsDocMap.delete(id);
          doc = undefined;
        }
        if (!doc) {
          doc = new Y.Doc();
          yjsDocMap.set(id, doc);
        }
        freshDocBoundRef.current = true;
        // The CollaborationPlugin connects/disconnects the provider.
        const provider = new WebsocketProvider(RTC_WS_URL, id, doc, {
          params: paramsRef.current,
          connect: false,
        });
        // 4001 = server force-refreshed access; re-mint immediately so the reconnect uses a fresh token (or flips to the error state if revoked).
        provider.on('connection-close', (e?: CloseEvent) => {
          if (e?.code === 4001) void refetchRef.current?.();
        });
        return provider;
      },
      username: awarenessName ?? name ?? 'User',
      cursorColor: awarenessColor ?? color ?? '#5a5ae2',
      shouldBootstrap: true,
    };
  }, [docId, name, color, awarenessName, awarenessColor]);

  if (isError) {
    return (
      <div className={`${s.tcEditor} tc-center`} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        Couldn't open this document for editing.
      </div>
    );
  }
  if (isLoading || !rtc) {
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
        uploadToServer={uploadToServer}
        viewOnly={rtc.role !== 'editor'}
        placeholder={rtc.role === 'editor' ? 'Start writing…' : 'This document is empty.'}
        config={EDITOR_CONFIG}
        minHeight={0}
        styles={EDITOR_STYLES}
      />
    </div>
  );
}
