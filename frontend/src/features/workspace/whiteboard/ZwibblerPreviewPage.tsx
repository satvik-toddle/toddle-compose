import { useCallback, useEffect, useState } from 'react';
import { DefaultFontStyle, Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import zwibblerDoc from './zwibbler-fixture.json';
import { zwibblerToTldraw, type ZwibblerNode } from './zwibblerToTldraw';
import { zwibblerToExcalidraw } from './zwibblerToExcalidraw';
import { WHITEBOARD_THEMES } from './whiteboardTheme';

// Dev-only harness (route /zwibbler-preview): renders the same legacy Zwibbler
// workbook through each candidate library's converter, side by side via the
// ?lib= switcher, to compare backward-compat fidelity. Non-synced canvases.

const FIXTURE = zwibblerDoc as unknown as ZwibblerNode[];
const LIBS = ['tldraw', 'excalidraw'] as const;
type Lib = (typeof LIBS)[number];

function TldrawPreview() {
  const onMount = useCallback((editor: Editor) => {
    editor.setStyleForNextShapes(DefaultFontStyle, 'sans');
    let cancelled = false;
    void zwibblerToTldraw(FIXTURE).then(({ shapes, assets, skipped }) => {
      if (cancelled) return;
      if (assets.length) editor.createAssets(assets);
      editor.createShapes(shapes);
      editor.zoomToFit();
      if (skipped.length) console.warn('[zwibbler-preview] unsupported node types:', skipped);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <Tldraw themes={WHITEBOARD_THEMES} onMount={onMount} />;
}

function ExcalidrawPreview() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void zwibblerToExcalidraw(FIXTURE).then(({ elements, files, skipped }) => {
      if (cancelled) return;
      if (files.length) api.addFiles(files);
      api.updateScene({ elements: convertToExcalidrawElements(elements) });
      api.scrollToContent(undefined, { fitToContent: true });
      if (skipped.length) console.warn('[zwibbler-preview] unsupported node types:', skipped);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return <Excalidraw excalidrawAPI={setApi} />;
}

export function ZwibblerPreviewPage() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('lib') as Lib | null;
  const lib: Lib = requested && LIBS.includes(requested) ? requested : 'tldraw';

  return (
    <div className="fixed inset-0 flex flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-secondary px-4 py-2">
        <span className="text-body-s text-secondary">Zwibbler conversion preview:</span>
        {LIBS.map((l) => (
          <a
            key={l}
            href={`?lib=${l}`}
            className={`rounded-1 px-2 py-1 text-body-s ${
              l === lib ? 'bg-[var(--panel-bg)] font-semibold' : 'text-secondary'
            }`}
          >
            {l}
          </a>
        ))}
      </div>
      <div className="relative flex-1 min-h-0">
        {lib === 'tldraw' ? <TldrawPreview /> : <ExcalidrawPreview />}
      </div>
    </div>
  );
}
