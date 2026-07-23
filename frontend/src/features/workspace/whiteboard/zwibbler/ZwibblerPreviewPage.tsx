import { useEffect, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import zwibblerDoc from './fixture.json';
import { zwibblerToExcalidraw, type ZwibblerNode } from './zwibblerToExcalidraw';

// Dev-only harness (route /zwibbler-preview): renders a legacy Zwibbler workbook
// on a local, non-synced Excalidraw canvas to validate the backward-compat converter.
export function ZwibblerPreviewPage() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void zwibblerToExcalidraw(zwibblerDoc as unknown as ZwibblerNode[]).then(
      ({ elements, files, skipped }) => {
        if (cancelled) return;
        if (files.length) api.addFiles(files);
        api.updateScene({ elements: convertToExcalidrawElements(elements) });
        api.scrollToContent(undefined, { fitToContent: true });
        if (skipped.length) console.warn('[zwibbler-preview] unsupported node types:', skipped);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div className="fixed inset-0">
      <Excalidraw excalidrawAPI={setApi} />
    </div>
  );
}
