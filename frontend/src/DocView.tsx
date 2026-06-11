import { useCallback, useEffect, useMemo, useState } from 'react';
// Use the editor's OWN bundled yjs + y-websocket so the Y.Doc we create matches
// the editor's @lexical/yjs instance (avoids the "Yjs was already imported" /
// silent collab-binding failure from two yjs copies).
import { DocEditor, Y, WebsocketProvider } from '@toddle-edu/ds-doc-editor';
import { api, uploadFile } from './api';
import { env } from './env';

type User = { id: string; email: string; name?: string; color?: string };
type ConnState = 'loading' | 'connecting' | 'connected' | 'disconnected' | 'error';

// The editor invokes this for image/media inserts. It calls us with an object
// ({ file, attachment, uploadId, ... }) — where `file` is a File or Blob — and
// expects the resolved Promise<string> to be a fetchable URL it can use as the
// node src. Older call sites may pass a bare File; accept both shapes.
type UploadArg = File | Blob | { file: File | Blob; attachment?: { name?: string } };

async function uploadToServer(arg: UploadArg): Promise<string> {
  const file = arg instanceof Blob ? arg : arg?.file;
  if (!file) throw new Error('uploadToServer: no file provided');
  const name = !(arg instanceof Blob) ? arg?.attachment?.name : undefined;
  const stored = await uploadFile(file, name);
  return stored.url;
}

export function DocView({ docId, me, onBack }: { docId: string; me: User; onBack: () => void }) {
  const [meta, setMeta] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ConnState>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setToken(null);
    (async () => {
      try {
        const m = await api(`/documents/${docId}`);
        if (cancelled) return;
        setMeta(m);
        setTitle(m.title ?? '');
        const t = await api(`/documents/${docId}/rtc-token`, { method: 'POST' });
        if (cancelled) return;
        setToken(t.token);
        setState('connecting');
      } catch (e: any) {
        setErr(e?.data ? JSON.stringify(e.data) : String(e));
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const providerFactory = useCallback(
    (id: string, yjsDocMap: Map<string, any>) => {
      const ydoc = new Y.Doc();
      yjsDocMap.set(id, ydoc);
      const p = new WebsocketProvider(env.rtcWsUrl, `yjs/${docId}`, ydoc, {
        connect: false,
        params: { token: token ?? '' },
      });
      p.on('status', (e: { status: string }) => {
        if (e.status === 'connected') { setState('connected'); setErr(null); }
        else if (e.status === 'connecting') setState('connecting');
        else if (e.status === 'disconnected') setState('disconnected');
      });
      p.on('connection-error', () => setState('error'));
      p.connect();
      return p;
    },
    [token, docId],
  );

  const collab = useMemo(() => {
    if (!token) return null;
    return {
      content: null,
      providerFactory,
      username: me.name ?? me.email,
      cursorColor: me.color ?? '#666',
      shouldBootstrap: true,
    };
  }, [token, me, providerFactory]);

  const canWrite = meta ? meta.canWrite !== false : false;

  async function saveTitle() {
    if (!meta || !canWrite || title === meta.title) return;
    try { setMeta(await api(`/documents/${docId}`, { method: 'PATCH', body: { title } })); }
    catch (e: any) { setErr(e?.data ? JSON.stringify(e.data) : String(e)); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid #e9e9e7', paddingBottom: 8, marginBottom: 8 }}>
        <div className="row">
          <button onClick={onBack}>← Back</button>
          <input className="title-input" value={title} disabled={!canWrite} placeholder="Untitled"
            onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
            style={{ fontSize: 16, fontWeight: 600, minWidth: 280 }} />
        </div>
        <span className="tag" title={`Connection: ${state}`}>{state}</span>
      </div>
      {err && <div className="banner">{err}</div>}
      {meta && !canWrite && <div className="banner">View-only — your edits won’t be saved.</div>}
      <div style={{ flex: 1, minHeight: 360, border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'auto' }} key={docId}>
        {collab ? (
          <DocEditor initialConfig={{ namespace: docId }} collab={collab} readOnly={!canWrite} uploadToServer={uploadToServer} />
        ) : (
          <div style={{ padding: 24 }} className="muted">{state === 'error' ? 'Failed to open document.' : 'Opening document…'}</div>
        )}
      </div>
    </div>
  );
}
