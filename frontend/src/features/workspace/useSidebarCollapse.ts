import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tc-sidebar';

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'open');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Cmd/Ctrl + \ toggles the sidebar from anywhere in the workspace.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggleShortcut = (e.metaKey || e.ctrlKey) && e.key === '\\';
      const isInitialPress = !e.repeat;
      if (isToggleShortcut && isInitialPress) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}
