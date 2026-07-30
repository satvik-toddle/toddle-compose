import { useSearchParams } from 'react-router-dom';
import { IconButton } from '@toddle-edu/ds-web';
import { CornersInOutlined } from '@toddle-edu/ds-icons';
import { useDocuments, useOpenDoc } from '../../hooks/usePages';
import { useAuthStore } from '../../stores/authStore';
import { DocActions } from './topbar/DocActions';
import { useFullScreenMode } from './useFullScreenMode';
import type { WorkspaceCtx } from './context';

const styles = {
  // Floating cluster in full-screen (topbar is hidden): page actions + the way back.
  panel: 'absolute right-3 top-3 z-50 flex items-center gap-2',
};

// Full-screen hides the topbar, so the page-actions menu (Full width, history, …) and the
// exit affordance float top-right instead. Resolves the open doc the same way the topbar does.
export function FullScreenControls({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const currentUser = useAuthStore((state) => state.user);
  const [params] = useSearchParams();
  const { data: docs = [] } = useDocuments(ctx.workspaceId);
  const { doc } = useOpenDoc(params.get('doc') ?? undefined, docs);
  const fullScreen = useFullScreenMode();

  if (!currentUser) return null;

  return (
    <div className={styles.panel}>
      <DocActions ctx={ctx} doc={doc} user={currentUser} />
      <IconButton
        dsVersion="2.0"
        variant="neutral"
        type="fill"
        icon={<CornersInOutlined />}
        aria-label="Exit full screen (Esc)"
        onClick={fullScreen.exit}
      />
    </div>
  );
}
