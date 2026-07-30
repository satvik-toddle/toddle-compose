import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const PARAM = 'fullscreen';

// Ephemeral full-screen view: hides the sidebar + topbar so the editor canvas fills the
// window. Kept in the URL (like history mode) so it survives reload and is shareable, but it
// is NOT persisted on the document. Esc exits; Cmd/Ctrl+Shift+F toggles (matches Notion).
//
// Pass { bindHotkeys: true } from exactly ONE mounted consumer (WorkspaceLayout). The hook is
// used by several components; binding the keydown in each would fire toggle once per listener
// and cancel itself out. Esc→exit is idempotent, but the toggle is not.
export function useFullScreenMode({ bindHotkeys = false } = {}) {
  const [params, setParams] = useSearchParams();
  const active = params.get(PARAM) === 'true';

  const enter = useCallback(() => {
    setParams((prev) => {
      prev.set(PARAM, 'true');
      return prev;
    });
  }, [setParams]);

  const exit = useCallback(() => {
    setParams((prev) => {
      prev.delete(PARAM);
      return prev;
    });
  }, [setParams]);

  const toggle = useCallback(() => {
    setParams((prev) => {
      if (prev.get(PARAM) === 'true') prev.delete(PARAM);
      else prev.set(PARAM, 'true');
      return prev;
    });
  }, [setParams]);

  useEffect(() => {
    if (!bindHotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (active) exit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindHotkeys, active, exit, toggle]);

  return { active, enter, exit, toggle };
}
