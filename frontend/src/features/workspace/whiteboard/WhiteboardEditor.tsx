import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ExcalidrawBinding } from 'y-excalidraw';
import { useRtcToken } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { PageLoader } from '../../../components/Loader';
import { RTC_WS_URL } from '../../../lib/env';

// Yjs shared-type keys, fixed by y-excalidraw's data model: an ordered element
// list ({el, pos} maps) plus an assets map. Distinct from the sheet's 'rows'
// key, which rtc-server history uses to sniff doc kinds.
const ELEMENTS_KEY = 'elements';
const ASSETS_KEY = 'assets';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
  message: 'flex-1 flex items-center justify-center text-body-s text-secondary',
};

// App theme resolved to what Excalidraw's `theme` prop accepts ('system' needs
// the live media query, same logic as themeStore.applyPreference).
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

type WhiteboardCanvasProps = { docId: string; token: string; canEdit: boolean };
type WhiteboardEditorProps = { docId: string };

// Inner canvas: owns the Y.Doc + websocket + Excalidraw binding lifecycle for one
// synced whiteboard. Mounted only once the RTC token is ready.
function WhiteboardCanvas({ docId, token, canEdit }: Readonly<WhiteboardCanvasProps>) {
  // y-websocket re-reads params.token on every reconnect; mutating this ref keeps a
  // long-lived session authed with a fresh token without tearing down the live doc.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;

  const user = useAuthStore((s) => s.user);
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);

  // The binding needs the imperative API, so the whole Yjs lifecycle waits for
  // Excalidraw's first render to hand it over.
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

    return () => {
      setBinding(null);
      excalidrawBinding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [api, docId, canEdit, user]);

  return (
    <div className={styles.shell}>
      <div ref={containerRef} className={styles.canvas}>
        <Excalidraw
          excalidrawAPI={setApi}
          onPointerUpdate={binding?.onPointerUpdate}
          theme={theme}
          viewModeEnabled={!canEdit}
          // Image assets are deferred until storage is designed (docs/whiteboard-integration.md).
          UIOptions={{ tools: { image: false } }}
        />
      </div>
    </div>
  );
}

// Real-time collaborative whiteboard (WHITEBOARD page type): binds the Excalidraw
// canvas to Yjs via y-excalidraw. Keyed by docId at the call site; the RTC role
// drives editability (viewers get a read-only canvas).
export function WhiteboardEditor({ docId }: Readonly<WhiteboardEditorProps>) {
  const { data: rtc, isLoading, isError } = useRtcToken(docId);

  if (isError) {
    return <div className={styles.message}>Couldn&apos;t open this whiteboard.</div>;
  }

  if (isLoading || !rtc) {
    return (
      <div className={styles.shell}>
        <PageLoader />
      </div>
    );
  }

  return <WhiteboardCanvas docId={docId} token={rtc.token} canEdit={rtc.role === 'editor'} />;
}
