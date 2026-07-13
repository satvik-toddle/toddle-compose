import { DefaultFontStyle, Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useRtcToken } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { PageLoader } from '../../../components/Loader';
import { useYjsTldrawStore } from './useYjsTldrawStore';
import { WHITEBOARD_THEMES } from './whiteboardTheme';

// tldraw's navigation panel starts with the minimap collapsed (localStorage
// key "minimap", true = collapsed). Seed it once so the minimap is open by
// default; later toggles by the user still persist.
try {
  if (localStorage.getItem('minimap') === null) localStorage.setItem('minimap', 'false');
} catch {
  // storage unavailable — tldraw falls back to collapsed
}

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
  message: 'flex-1 flex items-center justify-center text-body-s text-secondary',
};

type WhiteboardCanvasProps = { docId: string; token: string; canEdit: boolean };
type WhiteboardEditorProps = { docId: string };

// Inner canvas: binds a tldraw store to Yjs for one synced whiteboard. Mounted
// only once the RTC token is ready.
function WhiteboardCanvas({ docId, token, canEdit }: Readonly<WhiteboardCanvasProps>) {
  const user = useAuthStore((s) => s.user);
  const preference = useThemeStore((s) => s.preference);
  const storeWithStatus = useYjsTldrawStore({ docId, token, user });

  const onMount = (editor: Editor) => {
    if (!canEdit) editor.updateInstanceState({ isReadonly: true });
    // Default text/labels to the normal sans font, not tldraw's handwritten one.
    editor.setStyleForNextShapes(DefaultFontStyle, 'sans');
  };

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <Tldraw
          store={storeWithStatus}
          colorScheme={preference}
          themes={WHITEBOARD_THEMES}
          onMount={onMount}
          // No license key for the trial — tldraw shows its watermark. A business
          // license is required for production (docs/whiteboard-integration.md).
        />
      </div>
    </div>
  );
}

// Real-time collaborative whiteboard (WHITEBOARD page type): binds the tldraw
// canvas to Yjs via useYjsTldrawStore. Keyed by docId at the call site; the RTC
// role drives editability (viewers get a read-only canvas).
export function TldrawEditor({ docId }: Readonly<WhiteboardEditorProps>) {
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
