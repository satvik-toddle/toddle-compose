import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { TextInput, Alert, Button } from '@toddle-edu/ds-web';
import { EmailOutlined } from '@toddle-edu/ds-icons';
import { useForgotPassword } from '../../hooks/useAuthMutations';
import { useAuthConfig } from '../../hooks/queries';
import { messageOf } from '../../lib/errors';

const styles = {
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-5.5 text-body text-secondary',
  form: 'flex flex-col gap-4',
  glyph:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-info',
  centerHeading: 'text-heading-3 text-center',
  centerSub: 'mt-1.5 text-body text-secondary text-center',
  email: 'font-semibold text-primary',
};

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const { data: authConfig } = useAuthConfig();
  const [email, setEmail] = useState('');

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (forgot.isPending) return 'Sending…';
    return 'Send reset link';
  }, [forgot.isPending]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (forgot.isPending) return;
    forgot.mutate(email);
  };

  // No email service: route still reachable directly, so explain instead of a dead form.
  if (authConfig?.passwordResetEnabled === false) {
    return (
      <AuthShell
        foot={
          <span>
            Remembered it? <Link to="/login">Sign in</Link>
          </span>
        }
      >
        <h1 className={styles.heading}>Password reset unavailable</h1>
        <p className={styles.subheading}>
          This server doesn't have email set up, so passwords can't be reset by email. Contact your
          administrator for help signing in.
        </p>
      </AuthShell>
    );
  }

  // The response is intentionally generic (no account-existence leak), so once
  // the request succeeds we always show the same "check your email" screen.
  if (forgot.isSuccess) {
    return (
      <AuthShell
        foot={
          <span>
            Remembered it? <Link to="/login">Sign in</Link>
          </span>
        }
      >
        <div className={styles.glyph}>
          <EmailOutlined size="small" variant="link" />
        </div>
        <h1 className={styles.centerHeading}>Check your email</h1>
        <p className={styles.centerSub}>
          If an account exists for <span className={styles.email}>{email}</span>, we just sent a
          link to reset your password. The link expires in 15 minutes.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      foot={
        <span>
          Remembered it? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <h1 className={styles.heading}>Reset your password</h1>
      <p className={styles.subheading}>
        Enter your email and we'll send you a link to choose a new password.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        {forgot.isError && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(forgot.error, 'Could not send the email. Try again.')}
          />
        )}

        <TextInput
          dsVersion="2.0"
          label="Email"
          leadingIcon={<EmailOutlined />}
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="you@toddleapp.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        <Button
          dsVersion="2.0"
          htmlButtonType="submit"
          size="large"
          isFullWidth
          disabled={forgot.isPending}
        >
          {submitButtonLabel}
        </Button>
      </form>
    </AuthShell>
  );
}
