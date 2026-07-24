import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { Excalidraw, FONT_FAMILY } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
// y-excalidraw@2.0.12 peers on excalidraw ^0.17.6; we pin ^0.18.0. No published
// version supports 0.18, so verify multi-peer sync/z-order manually on upgrades.
import { ExcalidrawBinding } from 'y-excalidraw';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { Loader } from '../../../components/Loader';
import { RtcGate, type RtcSession } from '../RtcGate';
import { connectRtcProvider, useRtcParams } from '../useRtcProvider';
import { WhiteboardMinimap } from './WhiteboardMinimap';

// Yjs shared-type keys fixed by y-excalidraw's data model.
const ELEMENTS_KEY = 'elements';
const ASSETS_KEY = 'assets';

// Surface an error after this many failed connects with no sync, rather than
// leaving an editable-looking blank canvas that silently drops the user's work.
const CONNECT_FAILURE_LIMIT = 5;

// Presence identity for logged-out (link-shared) collaborators.
const ANON_USER = { name: 'Anonymous', color: '#4f52d9' };

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'relative flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
  overlay: 'absolute inset-0 flex items-center justify-center bg-surface-primary-enabled',
  overlayText: 'text-body-s text-secondary',
};

// Hoisted so the memoized Excalidraw doesn't re-render on a fresh object identity.
const UI_OPTIONS = { tools: { image: false } } as const;

// Default new text to a clean sans (closest bundled font to Avenir Next) instead of
// Excalidraw's hand-drawn default. Local UI state only — not part of the synced scene.
const INITIAL_DATA = { appState: { currentItemFontFamily: FONT_FAMILY.Nunito } };

const awarenessUser = (user: { name: string; color: string } | null) => {
  const identity = user ?? ANON_USER;
  return {
    name: identity.name,
    color: identity.color,
    colorLight: `${identity.color}33`,
  };
};

// The Y.Doc-backed shared types + awareness the binding reads from; kept in state so
// a canEdit flip re-binds over the live (already-synced) doc instead of an empty one.
type WhiteboardSession = {
  yElements: Y.Array<Y.Map<unknown>>;
  yAssets: Y.Map<unknown>;
  awareness: WebsocketProvider['awareness'];
};
type WhiteboardStatus = 'loading' | 'ready' | 'error';

type WhiteboardCanvasProps = { docId: string } & RtcSession;
type WhiteboardEditorProps = { docId: string };

function WhiteboardCanvas({ docId, token, canEdit, refetchToken }: Readonly<WhiteboardCanvasProps>) {
  const rtc = useRtcParams(token, refetchToken);
  // Lets the presence effect update the cursor in place instead of rebuilding the provider.
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);

  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.isDark) ? 'dark' : 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);
  const [session, setSession] = useState<WhiteboardSession | null>(null);
  const [status, setStatus] = useState<WhiteboardStatus>('loading');

  // Session (Y.Doc + provider) lives for as long as the doc is open. Keyed on
  // docId/api only, so a mid-session role flip rebuilds just the binding (below) —
  // never the synced doc — and can't blank the board. Waits for Excalidraw's first
  // render (the imperative API).
  useEffect(() => {
    if (!api || !containerRef.current) return;

    const ydoc = new Y.Doc();
    const yElements = ydoc.getArray<Y.Map<unknown>>(ELEMENTS_KEY);
    const yAssets = ydoc.getMap(ASSETS_KEY);

    setStatus('loading');
    let hasSynced = false;

    const { provider, teardown } = connectRtcProvider(docId, ydoc, rtc, (failures) => {
      if (!hasSynced && failures >= CONNECT_FAILURE_LIMIT) {
        provider.disconnect();
        setStatus('error');
      }
    });
    awarenessRef.current = provider.awareness;
    provider.awareness.setLocalStateField('user', awarenessUser(user));

    // Gate the canvas on the first server sync so the user can't edit against a
    // blank board before the existing elements load in.
    const onSync = (isSynced: boolean) => {
      if (isSynced && !hasSynced) {
        hasSynced = true;
        setStatus('ready');
      }
    };
    provider.on('sync', onSync);
    if (provider.synced) onSync(true);

    setSession({ yElements, yAssets, awareness: provider.awareness });

    return () => {
      provider.off('sync', onSync);
      teardown();
      awarenessRef.current = null;
      setSession(null);
      ydoc.destroy();
    };
  }, [api, docId]);

  // Rebuilt when the session or the editable role changes. The session's Y.Doc is
  // already synced, so a canEdit flip re-binds over the existing elements.
  useEffect(() => {
    const excalidrawDom = containerRef.current;
    if (!api || !session || !excalidrawDom) return;

    // Supplied only for editors; a read-only binding omits it.
    const editingOptions = canEdit
      ? { excalidrawDom, undoManager: new Y.UndoManager(session.yElements) }
      : undefined;
    const excalidrawBinding = new ExcalidrawBinding(
      session.yElements,
      session.yAssets,
      api,
      session.awareness,
      editingOptions,
    );
    setBinding(excalidrawBinding);

    return () => {
      setBinding(null);
      excalidrawBinding.destroy();
    };
  }, [api, session, canEdit]);

  // Reflect name/color changes onto the live cursor without tearing the session down.
  useEffect(() => {
    awarenessRef.current?.setLocalStateField('user', awarenessUser(user));
  }, [user]);

  return (
    <div className={styles.shell}>
      <div ref={containerRef} className={styles.canvas}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={INITIAL_DATA}
          onPointerUpdate={binding?.onPointerUpdate}
          theme={theme}
          viewModeEnabled={!canEdit}
          UIOptions={UI_OPTIONS}
        />
        {api && status === 'ready' && <WhiteboardMinimap api={api} />}
        {status !== 'ready' && (
          <div className={styles.overlay}>
            {status === 'error' ? (
              <span className={styles.overlayText}>
                Couldn&apos;t connect to the whiteboard server.
              </span>
            ) : (
              <Loader />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function WhiteboardEditor({ docId }: Readonly<WhiteboardEditorProps>) {
  return (
    <RtcGate docId={docId} noun="whiteboard">
      {(session) => <WhiteboardCanvas docId={docId} {...session} />}
    </RtcGate>
  );
}
