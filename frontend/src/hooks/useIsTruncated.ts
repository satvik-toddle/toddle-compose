import { useLayoutEffect, useRef, useState } from 'react';

// Tracks whether an element's text is clipped (scrollWidth > clientWidth).
// Re-measures on element resize and whenever `content` changes, so callers can
// gate a tooltip to only show when the text is actually truncated.
export function useIsTruncated<ElementType extends HTMLElement>(content: unknown) {
  const elementRef = useRef<ElementType>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const updateTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };

    updateTruncation();
    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [content]);

  return { elementRef, isTruncated };
}
