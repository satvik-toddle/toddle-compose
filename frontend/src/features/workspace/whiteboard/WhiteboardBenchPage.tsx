import { useCallback, useRef } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

// Dev-only perf harness (route /whiteboard-bench?n=1000): seeds n mixed elements,
// measures synchronous updateScene cost, then frame times over a 120-frame zoom
// oscillation. Results land in <pre id="bench-results"> for a headless runner.
export function WhiteboardBenchPage() {
  const started = useRef(false);

  const onApi = useCallback((api: ExcalidrawImperativeAPI) => {
    if (started.current) return;
    started.current = true;

    const n = Number(new URLSearchParams(window.location.search).get('n')) || 1000;
    const skeletons = [];
    for (let i = 0; i < n; i++) {
      const x = (i % 40) * 220;
      const y = Math.floor(i / 40) * 160;
      if (i % 3 === 2) {
        skeletons.push({ type: 'text' as const, x, y, text: `node ${i}` });
      } else {
        skeletons.push({
          type: i % 3 === 0 ? ('rectangle' as const) : ('ellipse' as const),
          x,
          y,
          width: 180,
          height: 120,
          backgroundColor: i % 3 === 0 ? '#4465e9' : '#e03131',
          fillStyle: 'solid' as const,
        });
      }
    }
    const elements = convertToExcalidrawElements(skeletons);

    // settle two frames after mount before measuring
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const t0 = performance.now();
        api.updateScene({ elements });
        const createMs = performance.now() - t0;
        api.scrollToContent(undefined, { fitToContent: true });

        const FRAMES = 120;
        const times: number[] = [];
        let frame = 0;
        let last = 0;
        const step = () => {
          const z = 0.15 + 0.85 * Math.abs(Math.sin(frame / 20));
          api.updateScene({
            appState: { zoom: { value: z as never }, scrollX: 200, scrollY: 200 },
          });
          const now = performance.now();
          if (frame > 0) times.push(now - last);
          last = now;
          frame += 1;
          if (frame < FRAMES) requestAnimationFrame(step);
          else finish();
        };

        const finish = () => {
          const sorted = [...times].sort((a, b) => a - b);
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          const el = document.createElement('pre');
          el.id = 'bench-results';
          el.style.position = 'fixed';
          el.style.zIndex = '9999';
          el.textContent = JSON.stringify({
            lib: 'excalidraw',
            n,
            createMs: +createMs.toFixed(1),
            avgFrameMs: +avg.toFixed(2),
            p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
            heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
          });
          document.body.appendChild(el);
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
