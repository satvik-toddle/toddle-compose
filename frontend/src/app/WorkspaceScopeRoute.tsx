import { useEffect, useRef, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { enterWorkspaceScope } from '../lib/session';
import { PageSpinner } from '../components/Spinner';
import { NoAccessPanel } from '../features/errors/NoAccessPanel';

type ScopeState = 'entering' | 'ready' | 'denied';

// Ensures the active access-token scope matches the :workspaceId in the URL
// before rendering the workspace. A 403/404 from enter → removed-mid-session.
export function WorkspaceScopeRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const qc = useQueryClient();
  const activeId = useAuthStore((s) => s.activeWorkspaceId);
  const [state, setState] = useState<ScopeState>(() =>
    activeId === workspaceId ? 'ready' : 'entering',
  );
  const enteringRef = useRef(false);

  useEffect(() => {
    if (!workspaceId) return;
    if (activeId === workspaceId) {
      setState('ready');
      return;
    }
    if (enteringRef.current) return;
    enteringRef.current = true;
    setState('entering');
    enterWorkspaceScope(qc, workspaceId)
      .then(() => setState('ready'))
      .catch(() => setState('denied'))
      .finally(() => {
        enteringRef.current = false;
      });
  }, [workspaceId, activeId, qc]);

  if (state === 'denied') return <NoAccessPanel />;
  if (state !== 'ready' || activeId !== workspaceId) {
    return (
      <div className="rbac">
        <PageSpinner />
      </div>
    );
  }
  return <Outlet />;
}
