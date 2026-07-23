import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ExcalidrawBinding } from 'y-excalidraw';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { RTC_WS_URL } from '../../../lib/env';
import { RtcGate, type RtcSession } from '../RtcGate';
import { attachTokenRecovery } from '../rtcReconnect';

// Yjs shared-type keys, fixed by y-excalidraw's data model: an ordered element
// list ({el, pos} maps) plus an assets map. Distinct from the sheet's 'rows'
// key, which rtc-server history uses to sniff doc kinds.
const ELEMENTS_KEY = 'elements';
const ASSETS_KEY = 'assets';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
};

// App theme resolved to what Excalidraw's `theme` prop accepts ('system' needs
// the live media query, mirroring themeStore.applyPreference).
function useResolvedTheme(): 'light' | 'dark' {
  const preference = useThemeStore((s) => s.preference);
  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : 'light';
}

type WhiteboardCanvasProps = { docId: string } & RtcSession;
type WhiteboardEditorProps = { docId: string };

// Owns the Y.Doc + websocket + Excalidraw binding lifecycle for one synced
// whiteboard. Mounted only once the RTC token is ready.
function WhiteboardCanvas({ docId, token, canEdit, refetchToken }: Readonly<WhiteboardCanvasProps>) {
  // y-websocket re-reads params.token on every reconnect; mutating this ref keeps a
  // long-lived session authed with a fresh token without tearing down the live doc.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;
  const refetchTokenRef = useRef(refetchToken);
  refetchTokenRef.current = refetchToken;
  // Set by the session effect; lets name/color changes update awareness in place
  // instead of tearing down the live provider.
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);

  const user = useAuthStore((s) => s.user);
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);

  // The binding needs the imperative API, so the whole Yjs lifecycle waits for
  // Excalidraw's first render to hand it over. Keyed on docId + canEdit only: the
  // binding bakes in write access (a role flip rebuilds it), but auth-user
  // hydration (null -> value) must not tear the live socket down — presence rides
  // awareness and updates in place below.
  useEffect(() => {
    const excalidrawDom = containerRef.current;
    if (!api || !excalidrawDom) return;

    const ydoc = new Y.Doc();
    const yElements = ydoc.getArray<Y.Map<unknown>>(ELEMENTS_KEY);
    const yAssets = ydoc.getMap(ASSETS_KEY);

    const provider = new WebsocketProvider(RTC_WS_URL, docId, ydoc, {
      params: paramsRef.current,
      connect: true,
    });
    awarenessRef.current = provider.awareness;
    if (user) {
      provider.awareness.setLocalStateField('user', {
        name: user.name,
        color: user.color,
        colorLight: `${user.color}33`,
      });
    }

    const excalidrawBinding = new ExcalidrawBinding(
      yElements,
      yAssets,
      api,
      provider.awareness,
      canEdit ? { excalidrawDom, undoManager: new Y.UndoManager(yElements) } : undefined,
    );
    setBinding(excalidrawBinding);

    // Shared re-mint protocol; the fresh token reaches the provider via paramsRef.
    const detachRecovery = attachTokenRecovery(provider, () => refetchTokenRef.current?.());

    return () => {
      detachRecovery();
      awarenessRef.current = null;
      setBinding(null);
      excalidrawBinding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [api, docId, canEdit]);

  // Presence metadata rides the live session; never tears it down.
  useEffect(() => {
    if (!user) return;
    awarenessRef.current?.setLocalStateField('user', {
      name: user.name,
      color: user.color,
      colorLight: `${user.color}33`,
    });
  }, [user]);

  return (
    <div className={styles.shell}>
      <div ref={containerRef} className={styles.canvas}>
        <Excalidraw
          excalidrawAPI={setApi}
          onPointerUpdate={binding?.onPointerUpdate}
          theme={theme}
          viewModeEnabled={!canEdit}
          // Image assets are deferred until storage is designed.
          UIOptions={{ tools: { image: false } }}
        />
      </div>
    </div>
  );
}

// Collaborative whiteboard (WHITEBOARD page type). Keyed by docId at the call
// site; the RTC role drives editability (viewers get a read-only canvas).
export function WhiteboardEditor({ docId }: Readonly<WhiteboardEditorProps>) {
  return (
    <RtcGate docId={docId} noun="whiteboard">
      {(session) => <WhiteboardCanvas docId={docId} {...session} />}
    </RtcGate>
  );
}
