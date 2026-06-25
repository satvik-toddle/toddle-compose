import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { Button, SpinnerLoader } from '@toddle-edu/ds-web';
import { TickCircleOutlined, WarningTriangleOutlined } from '@toddle-edu/ds-icons';
import { authApi } from '../../api/auth';
import { isApiError } from '../../lib/errors';

// 'declined' = the token is genuinely bad (400). 'error' = a transient failure
// (network/throttle/5xx) where the same link may still work — offer a retry.
type Status = 'progress' | 'authenticated' | 'declined' | 'error';

const styles = {
  glyphOk:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-success',
  glyphBad:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-error',
  spinnerWrap: 'mx-auto mb-4 flex h-14 w-14 items-center justify-center',
  heading: 'text-heading-3 text-center',
  subheading: 'mt-1.5 text-body text-secondary text-center',
  actions: 'mt-6 flex flex-col gap-3',
};

// Landing page for the link in the verification email
// (`/verify-email?token=...`). Shows "authentication in progress" while the
// token is exchanged, then "authenticated" or "request declined".
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [status, setStatus] = useState<Status>('progress');
  // StrictMode mounts effects twice in dev; verify-email is single-use, so guard
  // against the exchange auto-firing twice (the second would 400 as "already used").
  const autoStarted = useRef(false);

  const verify = useCallback(() => {
    if (!token) {
      setStatus('declined');
      return;
    }
    setStatus('progress');
    authApi
      .verifyEmail(token)
      .then(() => setStatus('authenticated'))
      // A 400 means the token is invalid/expired/used; anything else (network,
      // throttle, 5xx) is transient and the link may still be good.
      .catch((e) => setStatus(isApiError(e) && e.statusCode === 400 ? 'declined' : 'error'));
  }, [token]);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    verify();
  }, [verify]);

  if (status === 'progress') {
    return (
      <AuthShell>
        <div className={styles.spinnerWrap}>
          <SpinnerLoader size="small" />
        </div>
        <h1 className={styles.heading}>Authentication in progress</h1>
        <p className={styles.subheading}>Hang tight while we verify your email…</p>
      </AuthShell>
    );
  }

  if (status === 'authenticated') {
    return (
      <AuthShell>
        <div className={styles.glyphOk}>
          <TickCircleOutlined size="small" variant="success" />
        </div>
        <h1 className={styles.heading}>Authenticated</h1>
        <p className={styles.subheading}>
          Your email is verified and your account is active. You can sign in now.
        </p>
        <div className={styles.actions}>
          <Button size="large" isFullWidth onClick={() => navigate('/login')}>
            Continue to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (status === 'error') {
    return (
      <AuthShell
        foot={
          <span>
            Back to <Link to="/login">Sign in</Link>
          </span>
        }
      >
        <div className={styles.glyphBad}>
          <WarningTriangleOutlined size="small" variant="critical" />
        </div>
        <h1 className={styles.heading}>Something went wrong</h1>
        <p className={styles.subheading}>
          We couldn't reach the server to verify your email. Your link may still be valid — try
          again.
        </p>
        <div className={styles.actions}>
          <Button size="large" isFullWidth onClick={verify}>
            Try again
          </Button>
        </div>
      </AuthShell>
    );
  }

  // declined
  return (
    <AuthShell
      foot={
        <span>
          Back to <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <div className={styles.glyphBad}>
        <WarningTriangleOutlined size="small" variant="critical" />
      </div>
      <h1 className={styles.heading}>Request declined</h1>
      <p className={styles.subheading}>
        This verification link is invalid, has expired, or was already used. Sign in to request a
        fresh one.
      </p>
      <div className={styles.actions}>
        <Button size="large" isFullWidth onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </div>
    </AuthShell>
  );
}
