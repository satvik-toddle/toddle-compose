import { lazy, Suspense } from 'react';
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

// Public page for a share link. ANYONE-scope links open for anyone (logged in or
// out); REALM-scope links require a signed-in realm member (the resolve 401s
// otherwise). Renders a standalone collaborative editor keyed to the link token.
export function LinkDocView() {
  const { token = '' } = useParams();
  const { data, isLoading, error } = useShareLinkResolve(token);
  // Same query key DocEditor mints under, so this shares the cache (no extra request);
  // carries the guest identity baked into the RTC token for awareness cursors.
  const { data: rtc } = useShareLinkRtcToken(token);

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
    const needsSignIn = isApiError(error) && error.statusCode === 401;
    return (
      <div className="rbac">
        <div className={cn(styles.shell, 'relative')}>
          <div className={styles.floatingToggle}>
            <ThemeToggle />
          </div>
          <div className={cn(styles.centered, 'flex-col gap-4')}>
            <EmptyState
              dsVersion="2.0"
              illustration={
                needsSignIn
                  ? EmptyStateIllustrations.NoFoldersIllustration
                  : EmptyStateIllustrations.Error404Illustration
              }
              title={needsSignIn ? 'Sign in to open this link' : 'Link unavailable'}
              subtitle={
                needsSignIn
                  ? 'This link is limited to members of the workspace’s org. Sign in to continue.'
                  : 'This link is invalid or has been removed.'
              }
            />
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
          {doc.type === 'SHEET' ? (
            <div className={styles.centered}>
              <EmptyState
                dsVersion="2.0"
                illustration={EmptyStateIllustrations.NoFoldersIllustration}
                title="Open this sheet in the app"
                subtitle="Shared sheets open in the workspace. Sign in to view this sheet."
              />
            </div>
          ) : (
            <Suspense fallback={<PageLoader />}>
              <DocEditor
                key={doc.id}
                docId={doc.id}
                shareToken={token}
                awarenessName={rtc?.name}
                awarenessColor={rtc?.color}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
