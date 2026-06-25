import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { Alert, Button } from '@toddle-edu/ds-web';
import { EmailOutlined, RefreshArrowOutlined } from '@toddle-edu/ds-icons';
import { useResendVerification } from '../../hooks/useAuthMutations';
import { useCooldown, EMAIL_RESEND_COOLDOWN_SEC } from '../../hooks/useCooldown';
import { messageOf } from '../../lib/errors';

const styles = {
  glyph:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-info',
  heading: 'text-heading-3 text-center',
  subheading: 'mt-1.5 text-body text-secondary text-center',
  email: 'font-semibold text-primary',
  actions: 'mt-6 flex flex-col gap-3',
  note: 'mt-1 text-center text-body-s text-secondary',
};

// Shown after sign-up: the account exists but is unverified until the emailed
// link is opened. Reached via navigation state from RegisterPage.
export function CheckEmailPage() {
  const location = useLocation();
  const state = (location.state ?? null) as
    | { email?: string; emailDelivered?: boolean }
    | null;
  const email = state?.email ?? '';
  const resend = useResendVerification();
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown(EMAIL_RESEND_COOLDOWN_SEC);

  // An email was just sent during sign-up, so start the cooldown on arrival —
  // the server enforces the same window, so resending sooner is a no-op anyway.
  const { start } = cooldown;
  useEffect(() => {
    if (email) start();
  }, [email, start]);

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const resendButtonLabel = useMemo(() => {
    if (resend.isPending) return 'Resending…';
    if (cooldown.active) return `Resend available in ${cooldown.remaining}s`;
    return 'Resend verification email';
  }, [resend.isPending, cooldown.active, cooldown.remaining]);

  // Direct hit with no email in state → nothing to show; send them to register.
  if (!email) return <Navigate to="/register" replace />;

  const onResend = () => {
    if (resend.isPending || cooldown.active) return;
    resend.mutate(email, {
      onSuccess: () => {
        setResent(true);
        cooldown.start();
      },
    });
  };

  return (
    <AuthShell
      foot={
        <span>
          Already verified? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <div className={styles.glyph}>
        <EmailOutlined size="small" variant="link" />
      </div>
      <h1 className={styles.heading}>Check your email</h1>
      <p className={styles.subheading}>
        We sent a verification link to <span className={styles.email}>{email}</span>. Open it to
        activate your account, then come back to sign in.
      </p>

      {state?.emailDelivered === false && (
        <Alert
          dsVersion="2.0"
          type="info"
          message="Email delivery isn't configured on this server — check the backend logs for the verification link."
        />
      )}

      <div className={styles.actions}>
        {resent && (
          <Alert dsVersion="2.0" type="success" message="Sent again — check your inbox." />
        )}
        {resend.isError && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(resend.error, "Couldn't resend the email. Try again.")}
          />
        )}
        <Button
          size="large"
          isFullWidth
          variant="neutral"
          icon={<RefreshArrowOutlined />}
          disabled={resend.isPending || cooldown.active}
          onClick={onResend}
        >
          {resendButtonLabel}
        </Button>
      </div>

      <p className={styles.note}>The link expires in 15 minutes.</p>
    </AuthShell>
  );
}
