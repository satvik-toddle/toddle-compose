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

// Yjs shared-type keys fixed by y-excalidraw's data model.
const ELEMENTS_KEY = 'elements';
const ASSETS_KEY = 'assets';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
};

// Hoisted so the memoized Excalidraw doesn't re-render on a fresh object identity.
const UI_OPTIONS = { tools: { image: false } } as const;

const awarenessUser = (user: { name: string; color: string }) => ({
  name: user.name,
  color: user.color,
  colorLight: `${user.color}33`,
});

type WhiteboardCanvasProps = { docId: string } & RtcSession;
type WhiteboardEditorProps = { docId: string };

function WhiteboardCanvas({ docId, token, canEdit, refetchToken }: Readonly<WhiteboardCanvasProps>) {
  // y-websocket re-reads params.token on reconnect, so a fresh token stays live without a teardown.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;
  const refetchTokenRef = useRef(refetchToken);
  refetchTokenRef.current = refetchToken;
  // Lets the presence effect update the cursor in place instead of rebuilding the provider.
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null);

  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.isDark) ? 'dark' : 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);

  // Waits for Excalidraw's first render (the imperative API); canEdit rebuilds the binding, user does not.
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
    if (user) provider.awareness.setLocalStateField('user', awarenessUser(user));

    // Supplied only for editors; a read-only binding omits it.
    const editingOptions = canEdit
      ? { excalidrawDom, undoManager: new Y.UndoManager(yElements) }
      : undefined;
    const excalidrawBinding = new ExcalidrawBinding(
      yElements,
      yAssets,
      api,
      provider.awareness,
      editingOptions,
    );
    setBinding(excalidrawBinding);

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

  // Reflect name/color changes onto the live cursor without tearing the session down.
  useEffect(() => {
    if (user) awarenessRef.current?.setLocalStateField('user', awarenessUser(user));
  }, [user]);

  return (
    <div className={styles.shell}>
      <div ref={containerRef} className={styles.canvas}>
        <Excalidraw
          excalidrawAPI={setApi}
          onPointerUpdate={binding?.onPointerUpdate}
          theme={theme}
          viewModeEnabled={!canEdit}
          UIOptions={UI_OPTIONS}
        />
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
