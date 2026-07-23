import { useCallback } from 'react';
import { DefaultFontStyle, Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import zwibblerDoc from './fixture.json';
import { zwibblerToTldraw, type ZwibblerNode } from './zwibblerToTldraw';
import { WHITEBOARD_THEMES } from '../whiteboardTheme';

// Dev-only harness (route /zwibbler-preview): renders a legacy Zwibbler workbook
// on a local, non-synced tldraw canvas to validate the backward-compat converter.
export function ZwibblerPreviewPage() {
  const onMount = useCallback((editor: Editor) => {
    editor.setStyleForNextShapes(DefaultFontStyle, 'sans');
    let cancelled = false;
    void zwibblerToTldraw(zwibblerDoc as unknown as ZwibblerNode[]).then(
      ({ shapes, assets, skipped }) => {
        if (cancelled) return;
        if (assets.length) editor.createAssets(assets);
        editor.createShapes(shapes);
        editor.zoomToFit();
        if (skipped.length) console.warn('[zwibbler-preview] unsupported node types:', skipped);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0">
      <Tldraw themes={WHITEBOARD_THEMES} onMount={onMount} />
    </div>
  );
}
