import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualRow {
  index: number;
  start: number; // px offset from the top of the list
  measureRef: (el: HTMLElement | null) => void; // attach to the row to record its real height
}

export interface VirtualRows {
  items: VirtualRow[]; // only the rows in/near the viewport
  totalHeight: number;
  scrollToIndex: (index: number) => void; // bring a row into view (for keyboard nav)
}

// Dynamic-height windowing over a scroll container: renders only the rows in view, measuring
// each row's real height (rows here vary — title ± snippet ± path) and re-laying out from the
// measured sizes, falling back to `estimate` for rows not yet measured. Fixed-height lists
// don't need this — see the sidebar's inline windowing.
export function useVirtualRows(
  scrollEl: HTMLElement | null,
  count: number,
  estimate: number,
  overscan = 6,
): VirtualRows {
  const sizes = useRef<Map<number, number>>(new Map());
  const [version, setVersion] = useState(0); // bumps when a measurement changes → re-layout
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // Binding keys off the element so layout switches that remount the list rebind cleanly.
  useEffect(() => {
    const sc = scrollEl;
    if (!sc) return;
    const onScroll = () => setScrollTop(sc.scrollTop);
    setViewport(sc.clientHeight);
    setScrollTop(sc.scrollTop);
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewport(sc.clientHeight));
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollEl]);

  // Prefix-sum of row offsets from measured sizes (or the estimate). Recomputed when the row
  // count changes or a measurement lands (version). Dropped measurements for out-of-range
  // indices are harmless — they're just ignored.
  const offsets = useMemo(() => {
    const pos = new Array<number>(count + 1);
    pos[0] = 0;
    for (let i = 0; i < count; i++) pos[i + 1] = pos[i] + (sizes.current.get(i) ?? estimate);
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` triggers recompute after a measure
  }, [count, estimate, version]);

  const totalHeight = offsets[count] ?? 0;

  // First visible index: last offset <= scrollTop (binary search), minus overscan.
  const lo = Math.max(0, lowerBound(offsets, scrollTop, count) - overscan);
  const hi = Math.min(count, upperBound(offsets, scrollTop + viewport, count) + overscan);

  const makeMeasureRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      if (h > 0 && sizes.current.get(index) !== h) {
        sizes.current.set(index, h);
        setVersion((v) => v + 1);
      }
    },
    [],
  );

  const items: VirtualRow[] = [];
  for (let i = lo; i < hi; i++) items.push({ index: i, start: offsets[i], measureRef: makeMeasureRef(i) });

  const scrollToIndex = useCallback(
    (index: number) => {
      const sc = scrollEl;
      if (!sc || index < 0 || index >= count) return;
      const top = offsets[index];
      const bottom = offsets[index + 1];
      if (top < sc.scrollTop) sc.scrollTop = top;
      else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
    },
    [scrollEl, offsets, count],
  );

  return { items, totalHeight, scrollToIndex };
}

// Largest index with offsets[index] <= target (clamped to [0, count-1]).
function lowerBound(offsets: number[], target: number, count: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Smallest index with offsets[index] >= target (clamped to [0, count]).
function upperBound(offsets: number[], target: number, count: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
