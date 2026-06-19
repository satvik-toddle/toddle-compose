import { authState } from '../stores/authStore';
import { pushToast } from '../stores/uiStore';

// The router registers its navigate fn here so non-React code (the query cache
// error handler, the http layer) can redirect on access loss.
type Navigate = (to: string) => void;
let navigate: Navigate | null = null;
export function registerNavigate(fn: Navigate): void {
  navigate = fn;
}

let dropping = false;

// Removed/demoted mid-session: clear the active scope, toast, and bounce to the
// launcher. Debounced so several simultaneous 403s produce one drop.
export function dropToLauncher(
  message = 'Your access to this workspace changed. We brought you back to your workspaces.',
): void {
  if (dropping) return;
  dropping = true;
  authState().clearScopeLocal();
  pushToast({ kind: 'info', message });
  navigate?.('/launcher');
  queueMicrotask(() => {
    dropping = false;
  });
}
