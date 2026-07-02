import { useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEYBOARD_RESIZE_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './constants';

// Scoped per user so switching accounts on the same browser doesn't inherit
// the previous user's width.
const storageKey = (userId: string) => `tc-sidebar-width:${userId}`;

const clampWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

const readStoredWidth = (userId: string) => {
  try {
    const storedWidth = Number(localStorage.getItem(storageKey(userId)));
    return storedWidth ? clampWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
};

const persistWidth = (userId: string, width: number) => {
  try {
    localStorage.setItem(storageKey(userId), String(width));
  } catch {
    /* ignore */
  }
};

export function useSidebarWidth() {
  const userId = useAuthStore((state) => state.user?.id ?? 'anon');
  const [width, setWidth] = useState(() => readStoredWidth(userId));
  const [isResizing, setIsResizing] = useState(false);

  // Drag the right-edge handle: width tracks the cursor and is persisted on release.
  const startResize = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      let latestWidth = startWidth;
      setIsResizing(true);

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        latestWidth = clampWidth(startWidth + moveEvent.clientX - startX);
        setWidth(latestWidth);
      };
      const handleMouseUp = () => {
        setIsResizing(false);
        persistWidth(userId, latestWidth);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Keep the resize cursor and suppress text selection across the whole drag.
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, userId],
  );

  // Arrow keys nudge the width when the handle is focused (keyboard accessibility).
  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const step =
        event.key === 'ArrowLeft' ? -SIDEBAR_KEYBOARD_RESIZE_STEP : SIDEBAR_KEYBOARD_RESIZE_STEP;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setWidth((current) => {
        const nextWidth = clampWidth(current + step);
        persistWidth(userId, nextWidth);
        return nextWidth;
      });
    },
    [userId],
  );

  return { width, isResizing, startResize, handleResizeKeyDown };
}
