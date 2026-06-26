import { useState } from 'react';

const STORAGE_KEY = 'tc-sidebar';

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'open');
      } catch {
        /* ignore */
      }
      return next;
    });

  return { collapsed, toggle };
}
