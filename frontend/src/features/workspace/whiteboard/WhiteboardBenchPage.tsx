import { useCallback, useRef } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

// Dev perf harness (/whiteboard-bench?n=1000): times a bulk create then frames of a zoom
// oscillation, writing results to <pre id="bench-results"> for a headless runner.

const DEFAULT_ELEMENT_COUNT = 1000;
const COLUMNS = 40;
const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 160;
const MEASURED_FRAMES = 120;

export function WhiteboardBenchPage() {
  const started = useRef(false);

  const onApi = useCallback((api: ExcalidrawImperativeAPI) => {
    if (started.current) return;
    started.current = true;

    const requestedCount = Number(new URLSearchParams(window.location.search).get('n'));
    const elementCount = requestedCount || DEFAULT_ELEMENT_COUNT;

    const skeletons = [];
    for (let index = 0; index < elementCount; index++) {
      const x = (index % COLUMNS) * COLUMN_WIDTH;
      const y = Math.floor(index / COLUMNS) * ROW_HEIGHT;
      const isText = index % 3 === 2;
      const isRectangle = index % 3 === 0;
      if (isText) {
        skeletons.push({ type: 'text' as const, x, y, text: `node ${index}` });
      } else {
        skeletons.push({
          type: isRectangle ? ('rectangle' as const) : ('ellipse' as const),
          x,
          y,
          width: 180,
          height: 120,
          backgroundColor: isRectangle ? '#4465e9' : '#e03131',
          fillStyle: 'solid' as const,
        });
      }
    }
    const elements = convertToExcalidrawElements(skeletons);

    // Settle two frames after mount before measuring.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const createStart = performance.now();
        api.updateScene({ elements });
        const createMs = performance.now() - createStart;
        api.scrollToContent(undefined, { fitToContent: true });

        const frameTimes: number[] = [];
        let frameIndex = 0;
        let lastTimestamp = 0;

        const step = () => {
          const zoom = 0.15 + 0.85 * Math.abs(Math.sin(frameIndex / 20));
          api.updateScene({
            appState: { zoom: { value: zoom as never }, scrollX: 200, scrollY: 200 },
          });
          const now = performance.now();
          if (frameIndex > 0) frameTimes.push(now - lastTimestamp);
          lastTimestamp = now;
          frameIndex += 1;
          if (frameIndex < MEASURED_FRAMES) requestAnimationFrame(step);
          else writeResults();
        };

        const writeResults = () => {
          const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
          const averageFrameMs = frameTimes.reduce((sum, ms) => sum + ms, 0) / frameTimes.length;
          const p95Index = Math.floor(sortedFrameTimes.length * 0.95);
          const heapMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } })
            .memory;
          const resultsElement = document.createElement('pre');
          resultsElement.id = 'bench-results';
          resultsElement.style.position = 'fixed';
          resultsElement.style.zIndex = '9999';
          resultsElement.textContent = JSON.stringify({
            lib: 'excalidraw',
            n: elementCount,
            createMs: +createMs.toFixed(1),
            avgFrameMs: +averageFrameMs.toFixed(2),
            p95FrameMs: +sortedFrameTimes[p95Index].toFixed(2),
            heapMB: heapMemory ? +(heapMemory.usedJSHeapSize / 1048576).toFixed(1) : null,
          });
          document.body.appendChild(resultsElement);
        };

        requestAnimationFrame(step);
      }),
    );
  }, []);

  return (
    <div className="fixed inset-0">
      <Excalidraw excalidrawAPI={onApi} />
    </div>
  );
}
