import { useMemo, useRef } from 'react';
import { DocEditor as DsDocEditor, WebsocketProvider, Y } from '@toddle-edu/ds-doc-editor';
// The editor's styles (self-contained — bundles its own antd layer).
import '@toddle-edu/ds-doc-editor/dist/main.css';
import { useRtcToken } from '../../hooks/usePages';
import { useShareLinkRtcToken } from '../../hooks/useShareLink';
import { uploadFileWithProgress } from '../../api/uploads';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { uploadStore } from '../../stores/uploadStore';
import { useAuthStore } from '../../stores/authStore';
import { PageLoader } from '../../components/Loader';
import { RTC_WS_URL } from '../../lib/env';
import { DOC_COLUMN_WIDTH, DOC_SIDE_PADDING } from './constants';
import { attachTokenRecovery } from './rtcReconnect';
import s from './DocEditor.module.scss';

// Hide the editor's built-in top toolbar — formatting comes from the floating
// selection toolbar + slash menu (Coda-style). The editable surface then fills
// the full width and height of the page pane (no centered 800px column).
// Exported so the read-only history snapshot (DocSnapshotViewer) renders with identical chrome.
export const EDITOR_CONFIG = { toolbar: { enabled: false } };

// Full document page: centered 900px readable column, generous side padding. The scroll
// container's own overflow + viewport max-height are removed so the PAGE scrolls (title +
// content together) — see .tc-editor-page and PageView's contentShell.
const DOC_STYLES = {
  scrollableContainer: { overflow: 'visible', maxHeight: 'none', background: 'var(--panel-bg)' },
  anchorElement: { width: '100%', maxWidth: `${DOC_COLUMN_WIDTH}px`, margin: '0 auto' },
  contentBgProvider: { minHeight: '100%', padding: `0 ${DOC_SIDE_PADDING}px 80px`, background: 'var(--panel-bg)' },
};

// Search preview pane: full-width in the narrow pane with tight 16px side padding.
const PREVIEW_STYLES = {
  scrollableContainer: { height: '100%', background: 'var(--panel-bg)' },
  anchorElement: { width: '100%', maxWidth: '100%' },
  contentBgProvider: { minHeight: '100%', padding: '0 16px 80px', background: 'var(--panel-bg)' },
  contentEditable: { paddingLeft: '16px', paddingRight: '16px' },
};

// Exported for the read-only history snapshot: full-width, internal scrolling flattened so the
// page-level wrapper (title + editor) scrolls as one.
export const EDITOR_STYLES = {
  scrollableContainer: {
    height: 'auto',
    maxHeight: 'none',
    overflow: 'visible',
    background: 'var(--panel-bg)',
  },
  anchorElement: { width: '100%', maxWidth: '100%' },
  contentBgProvider: { minHeight: '100%', padding: '0 16px 80px', background: 'var(--panel-bg)' },
  contentEditable: { paddingLeft: '16px', paddingRight: '16px' },
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
  // Anonymous link visitors have no access token and /uploads is auth-guarded; fail fast with a clear message (passing undefined instead would hit the editor's silent no-op default and insert a broken empty-src image).
  if (!useAuthStore.getState().accessToken) {
    pushToast({ kind: 'error', message: 'Sign in to upload images and files' });
    throw new Error('uploads require sign-in');
  }
  const file = arg instanceof Blob ? arg : arg?.file;
  if (!file) throw new Error('uploadToServer: no file provided');
  const attachment = arg instanceof Blob ? undefined : arg?.attachment;
  const name = uploadName(file, attachment) ?? (file instanceof File ? file.name : 'upload');
  // Register in the bottom-right progress panel and stream byte-progress into it.
  const id = uploadStore().start({
    name,
    size: file.size ?? 0,
    type: file.type || attachment?.mimeType || '',
  });
  try {
    const stored = await uploadFileWithProgress(file, name, {
      onProgress: (pct) => uploadStore().setProgress(id, pct),
    });
    uploadStore().complete(id);
    return stored.url;
  } catch (e) {
    uploadStore().fail(id, messageOf(e));
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
  viewOnly: forceViewOnly,
  preview = false,
}: {
  docId: string;
  canEdit?: boolean;
  shareToken?: string;
  // Force read-only regardless of the RTC role (e.g. the search preview pane).
  viewOnly?: boolean;
  // Compact layout for the search preview pane (full-width, tight padding) vs the 900px doc page.
  preview?: boolean;
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
  // Failure counters shared across providerFactory re-invocations (StrictMode, collab re-memo) so the 2-failure re-mint streak survives provider recreation.
  const recoveryStateRef = useRef({ sinceRemint: 0, sinceConnect: 0, attemptCounted: false });

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
        // Listeners live as long as the provider (the CollaborationPlugin destroys it); no detach needed.
        attachTokenRecovery(provider, () => refetchRef.current?.(), undefined, recoveryStateRef.current);
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
    <div className={preview ? s.tcEditor : `${s.tcEditor} ${s.tcEditorPage}`}>
      <DsDocEditor
        collab={collab}
        uploadToServer={uploadToServer}
        viewOnly={forceViewOnly ?? rtc.role !== 'editor'}
        placeholder={
          !forceViewOnly && rtc.role === 'editor' ? 'Start writing…' : 'This document is empty.'
        }
        config={EDITOR_CONFIG}
        minHeight={0}
        // 900px readable column on the full doc page; full-width (100%) in the narrow preview pane.
        width={preview ? '100%' : DOC_COLUMN_WIDTH}
        styles={preview ? PREVIEW_STYLES : DOC_STYLES}
      />
    </div>
  );
}
