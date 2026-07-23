import { lazy, Suspense, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, Button } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { PageLoader } from '../../components/Loader';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { useShareLinkResolve, useShareLinkRtcToken } from '../../hooks/useShareLink';
import { isApiError } from '../../lib/errors';
import { useThemeStore } from '../../stores/themeStore';

const DocEditor = lazy(() =>
  import('../workspace/DocEditor').then((m) => ({ default: m.DocEditor })),
);

const styles = {
  shell: 'flex flex-col h-screen bg-[var(--panel-bg)]',
  header: 'flex-none flex items-center gap-2.5 px-7.5 py-4 border-b border-secondary',
  title: 'text-heading-4 text-primary truncate',
  body: 'flex-1 min-h-0 flex flex-col',
  centered: 'flex-1 flex items-center justify-center p-10',
  floatingToggle: 'absolute top-4 right-4 z-10',
};

// Flips the effective theme for anonymous visitors: dark -> light, else -> dark.
function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const isDark =
    preference === 'dark' ||
    (preference === 'system' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <IconButton
      icon="BulbOutlined"
      aria-label="Switch theme"
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setPreference(isDark ? 'light' : 'dark')}
    />
  );
}

// Public share-link page: ANYONE-scope opens for anyone, REALM-scope needs a signed-in realm member (401 signed-out / 403 non-member); renders a standalone collaborative editor keyed to the link token.
export function LinkDocView() {
  const { token = '' } = useParams();
  const { data, isLoading, error } = useShareLinkResolve(token);
  // Same query key DocEditor mints under (shared cache, no extra request); carries the guest identity baked into the RTC token for awareness cursors.
  const { data: rtc } = useShareLinkRtcToken(token);
  // Freeze the first minted identity for the page's lifetime: the backend re-rolls a random guest name/color on every 4-min re-mint for anonymous visitors, and these feed DocEditor's collab memo, so without freezing the cursor identity would churn (and the provider reconnect) every 4 minutes.
  const frozenIdentity = useRef<{ name?: string; color?: string } | null>(null);
  if (frozenIdentity.current === null && rtc?.name) {
    frozenIdentity.current = { name: rtc.name, color: rtc.color };
  }
  const identity = frozenIdentity.current;

  if (isLoading) {
    return (
      <div className="rbac">
        <div className={cn(styles.shell, 'relative')}>
          <div className={styles.floatingToggle}>
            <ThemeToggle />
          </div>
          <PageLoader />
        </div>
      </div>
    );
  }

  if (error || !data) {
    // 401 = unauthenticated on a REALM link (offer sign-in); 403 = signed in but not a
    // member of the link's org — showing sign-in there is the dead-end loop, so omit it.
    const needsSignIn = isApiError(error) && error.statusCode === 401;
    const forbidden = isApiError(error) && error.statusCode === 403;
    let illustration = EmptyStateIllustrations.Error404Illustration;
    let title = 'Link unavailable';
    let subtitle = 'This link is invalid or has been removed.';
    if (needsSignIn) {
      illustration = EmptyStateIllustrations.NoFoldersIllustration;
      title = 'Sign in to open this link';
      subtitle = 'This link is limited to members of the workspace’s org. Sign in to continue.';
    } else if (forbidden) {
      illustration = EmptyStateIllustrations.NoAccessIllustration;
      title = "You don't have access to this link";
      subtitle = 'This link is limited to members of the workspace’s org.';
    }
    return (
      <div className="rbac">
        <div className={cn(styles.shell, 'relative')}>
          <div className={styles.floatingToggle}>
            <ThemeToggle />
          </div>
          <div className={cn(styles.centered, 'flex-col gap-4')}>
            <EmptyState dsVersion="2.0" illustration={illustration} title={title} subtitle={subtitle} />
            {needsSignIn && (
              <Link to="/login">
                <Button dsVersion="2.0" variant="primary" type="fill">
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { document: doc } = data;

  return (
    <div className="rbac">
      <div className={styles.shell}>
        <div className={styles.header}>
          <span className={styles.title}>{doc.title || 'Untitled'}</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
        <div className={styles.body}>
          {doc.type !== 'DOC' ? (
            // Only the rich-text editor supports standalone share-token mode;
            // sheets and whiteboards open in the workspace.
            <div className={styles.centered}>
              <EmptyState
                dsVersion="2.0"
                illustration={EmptyStateIllustrations.NoFoldersIllustration}
                title={`Open this ${doc.type === 'SHEET' ? 'sheet' : 'whiteboard'} in the app`}
                subtitle="Shared pages of this type open in the workspace. Sign in to view it."
              />
            </div>
          ) : (
            <Suspense fallback={<PageLoader />}>
              <DocEditor
                key={doc.id}
                docId={doc.id}
                shareToken={token}
                awarenessName={identity?.name}
                awarenessColor={identity?.color}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
