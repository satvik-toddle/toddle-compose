import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';

// ⌘/Ctrl+K opens the doc-search modal, scoped to the current workspace route
// (`/w/:workspaceId/*` ⇒ in-workspace, else global). No-op until authenticated
// so login/register routes stay unaffected. Mounted once in App.
export function useSearchShortcut() {
  const location = useLocation();
  const openModal = useUiStore((s) => s.openModal);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== 'authed') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const workspaceId = matchPath('/w/:workspaceId/*', location.pathname)?.params.workspaceId;
        openModal(workspaceId ? { type: 'search', workspaceId } : { type: 'search' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, location.pathname, openModal]);
}
