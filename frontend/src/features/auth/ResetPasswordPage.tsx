import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { PasswordStrength } from './PasswordStrength';
import { PasswordTextInput, Alert, Button } from '@toddle-edu/ds-web';
import { LockOutlined, TickCircleOutlined, WarningTriangleOutlined } from '@toddle-edu/ds-icons';
import { useResetPassword } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

const styles = {
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-5.5 text-body text-secondary',
  centerHeading: 'text-heading-3 text-center',
  centerSub: 'mt-1.5 text-body text-secondary text-center',
  form: 'flex flex-col gap-4',
  errorText: 'flex items-center gap-1.5 text-body-s text-semantic-error',
  glyphOk:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-success',
  glyphBad:
    'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-semantic-error',
  actions: 'mt-6 flex flex-col gap-3',
};

// Landing page for the link in the password-reset email
// (`/reset-password?token=...`). Collects a new password and submits it; the
// token is validated server-side on submit.
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const reset = useResetPassword();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isPasswordMismatched = confirmPassword.length > 0 && confirmPassword !== password;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const resetButtonLabel = useMemo(() => {
    if (reset.isPending) return 'Resetting…';
    return 'Reset password';
  }, [reset.isPending]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPasswordMismatched || reset.isPending) return;
    reset.mutate({ token, password });
  };

  // No token in the URL → the link is malformed; treat as invalid.
  if (!token) {
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
        <h1 className={styles.centerHeading}>Link not valid</h1>
        <p className={styles.centerSub}>
          This password reset link is missing or malformed. Request a new one from the sign-in page.
        </p>
        <div className={styles.actions}>
          <Button size="large" isFullWidth onClick={() => navigate('/forgot-password')}>
            Request a new link
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthShell>
        <div className={styles.glyphOk}>
          <TickCircleOutlined size="small" variant="success" />
        </div>
        <h1 className={styles.centerHeading}>Password updated</h1>
        <p className={styles.centerSub}>
          Your password has been reset. Sign in with your new password.
        </p>
        <div className={styles.actions}>
          <Button size="large" isFullWidth onClick={() => navigate('/login')}>
            Continue to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      foot={
        <span>
          Back to <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <h1 className={styles.heading}>Choose a new password</h1>
      <p className={styles.subheading}>Pick a strong password you don't use elsewhere.</p>

      <form className={styles.form} onSubmit={onSubmit}>
        {reset.isError && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(
              reset.error,
              'This reset link is invalid or has expired. Request a new one.',
            )}
          />
        )}

        <PasswordTextInput
          dsVersion="2.0"
          label="New password"
          leadingIcon={<LockOutlined />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoFocus
        />
        <PasswordStrength password={password} />
        <PasswordTextInput
          dsVersion="2.0"
          label="Confirm new password"
          leadingIcon={<LockOutlined />}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={isPasswordMismatched ? ' ' : undefined}
          required
        />

        {isPasswordMismatched && (
          <span className={styles.errorText}>
            <WarningTriangleOutlined variant="critical" size="xxx-small" />
            Passwords don't match.
          </span>
        )}

        <Button
          dsVersion="2.0"
          htmlButtonType="submit"
          size="large"
          isFullWidth
          disabled={reset.isPending}
        >
          {resetButtonLabel}
        </Button>
      </form>
    </AuthShell>
  );
}
