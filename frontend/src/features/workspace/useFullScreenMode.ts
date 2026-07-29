import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const PARAM = 'fullscreen';

// Ephemeral full-screen view: hides the sidebar + topbar so the editor canvas fills the
// window. Kept in the URL (like history mode) so it survives reload and is shareable, but it
// is NOT persisted on the document. Esc exits.
export function useFullScreenMode() {
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

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, exit]);

  return { active, enter, exit };
}
