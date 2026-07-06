import { useCallback, useEffect, useState } from 'react';
import { SHEET_PANEL_SHORTCUT_KEY } from './constants';

// Open state for the sheet's options overlay, plus its Cmd/Ctrl+/ toggle.
// Shortcut is inert for viewers via isEnabled.
export function useSheetPanel(isEnabled: boolean) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isToggleShortcut =
        (event.metaKey || event.ctrlKey) && event.key === SHEET_PANEL_SHORTCUT_KEY;
      if (isToggleShortcut && !event.repeat) {
        event.preventDefault();
        setIsOpen((wasOpen) => !wasOpen);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [isEnabled]);

  return { isOpen, open, close };
}
