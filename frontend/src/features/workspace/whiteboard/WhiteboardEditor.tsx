import { useEffect, useState } from 'react';
import { DefaultFontStyle, Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { RtcGate } from '../RtcGate';
import { useYjsTldrawStore } from './useYjsTldrawStore';
import { WHITEBOARD_THEMES } from './whiteboardTheme';

// tldraw's navigation panel starts with the minimap collapsed (localStorage
// key "minimap", true = collapsed). Seed it once so the minimap is open by
// default; later toggles by the user still persist.
function seedMinimapOpen() {
  try {
    if (localStorage.getItem('minimap') === null) localStorage.setItem('minimap', 'false');
  } catch {
    // storage unavailable — tldraw falls back to collapsed
  }
}

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
};

type WhiteboardCanvasProps = {
  docId: string;
  token: string;
  canEdit: boolean;
  refetchToken: () => Promise<unknown>;
};
type WhiteboardEditorProps = { docId: string };

// Mounted only once the RTC token is ready.
function WhiteboardCanvas({ docId, token, canEdit, refetchToken }: Readonly<WhiteboardCanvasProps>) {
  const user = useAuthStore((s) => s.user);
  const preference = useThemeStore((s) => s.preference);
  const storeWithStatus = useYjsTldrawStore({ docId, token, user, refetchToken });
  const [editor, setEditor] = useState<Editor | null>(null);
  // Lazy initializer: runs once per mount, before <Tldraw> reads the key.
  useState(seedMinimapOpen);

  const onMount = (editor: Editor) => {
    setEditor(editor);
    // Default text/labels to the normal sans font, not tldraw's handwritten one.
    editor.setStyleForNextShapes(DefaultFontStyle, 'sans');
  };

  // The role can flip mid-session (token re-mints); a demoted editor must lose
  // write access live — rtc-server already drops their writes silently.
  useEffect(() => {
    editor?.updateInstanceState({ isReadonly: !canEdit });
  }, [editor, canEdit]);

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <Tldraw
          store={storeWithStatus}
          colorScheme={preference}
          themes={WHITEBOARD_THEMES}
          onMount={onMount}
          // No license key for the trial — tldraw shows its watermark. A business
          // license is required for production.
        />
      </div>
    </div>
  );
}

// Collaborative whiteboard (WHITEBOARD page type). Keyed by docId at the call
// site; the RTC role drives editability.
export function WhiteboardEditor({ docId }: Readonly<WhiteboardEditorProps>) {
  return (
    <RtcGate docId={docId} noun="whiteboard">
      {(session) => <WhiteboardCanvas docId={docId} {...session} />}
    </RtcGate>
  );
}
