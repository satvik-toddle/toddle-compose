import { useCallback, useEffect, useState } from 'react';

export interface VirtualRow {
  index: number;
  start: number; // px offset from the top of the list
}

export interface VirtualRows {
  items: VirtualRow[]; // only the rows in/near the viewport
  totalHeight: number;
  scrollToIndex: (index: number) => void; // bring a row into view (for keyboard nav)
}

// Fixed-height windowing over a scroll container: uniform rows make offsets pure
// arithmetic — nothing is measured, so nothing goes stale on layout switches.
export function useVirtualRows(
  scrollEl: HTMLElement | null,
  count: number,
  rowHeight: number,
  overscan = 6,
): VirtualRows {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // Render-phase reset on element identity change: a remounted list's first frame must window from its real scroll state.
  const [prevEl, setPrevEl] = useState(scrollEl);
  if (prevEl !== scrollEl) {
    setPrevEl(scrollEl);
    setScrollTop(scrollEl ? scrollEl.scrollTop : 0);
    setViewport(scrollEl ? scrollEl.clientHeight : 0);
  }

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

  const lo = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const hi = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  const items: VirtualRow[] = [];
  for (let i = lo; i < hi; i++) items.push({ index: i, start: i * rowHeight });

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!scrollEl || index < 0 || index >= count) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < scrollEl.scrollTop) scrollEl.scrollTop = top;
      else if (bottom > scrollEl.scrollTop + scrollEl.clientHeight)
        scrollEl.scrollTop = bottom - scrollEl.clientHeight;
    },
    [scrollEl, count, rowHeight],
  );

  return { items, totalHeight: count * rowHeight, scrollToIndex };
}
