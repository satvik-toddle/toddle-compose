import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { TextInput, PasswordTextInput, Checkbox, Button, Alert } from '@toddle-edu/ds-web';
import { EmailOutlined, LockOutlined } from '@toddle-edu/ds-icons';
import { useLogin, useResendVerification } from '../../hooks/useAuthMutations';
import { useAuthConfig } from '../../hooks/queries';
import { useCooldown, EMAIL_RESEND_COOLDOWN_SEC } from '../../hooks/useCooldown';
import { isEmailNotVerified, messageOf } from '../../lib/errors';

const styles = {
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-5.5 text-body text-secondary',
  form: 'flex flex-col gap-4',
  row: 'flex items-center justify-between text-body-s',
  notVerified: 'flex flex-col gap-2',
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Set when register redirected here (email service bypassed); account is ready to sign in.
  const registeredEmail = (location.state as { registered?: string } | null)?.registered;
  const login = useLogin();
  const resend = useResendVerification();
  const { data: authConfig } = useAuthConfig();
  // Default to enabled until config loads; hide only when the server reports it off.
  const passwordResetEnabled = authConfig?.passwordResetEnabled !== false;
  const [email, setEmail] = useState(registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown(EMAIL_RESEND_COOLDOWN_SEC);
  // Credentials are valid but the email was never verified — a distinct,
  // non-error state ("user not authenticated") rather than a bad-password.
  const notVerified = isEmailNotVerified(login.error);
  const loginFailed = login.isError && !notVerified;
  const isLoggingIn = login.isPending;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (isLoggingIn) return 'Signing in…';
    return 'Sign in';
  }, [isLoggingIn]);

  const resendButtonLabel = useMemo(() => {
    if (resend.isPending) return 'Sending…';
    if (cooldown.active) return `Resend available in ${cooldown.remaining}s`;
    return 'Resend verification email';
  }, [resend.isPending, cooldown.active, cooldown.remaining]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setResent(false);
    login.mutate({ email, password }, { onSuccess: () => navigate('/') });
  };

  const onResend = () => {
    if (resend.isPending || cooldown.active || !email) return;
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
          New to Toddle Compose? <Link to="/register">Create an account</Link>
        </span>
      }
    >
      <h1 className={styles.heading}>Welcome back</h1>
      <p className={styles.subheading}>Sign in to reach your workspaces.</p>

      <form className={styles.form} onSubmit={onSubmit}>
        {registeredEmail && !login.isError && (
          <Alert
            dsVersion="2.0"
            type="success"
            message="Your account is ready. Sign in to continue."
          />
        )}

        {loginFailed && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(login.error, "That email and password don't match. Try again.")}
          />
        )}

        {notVerified && (
          <div className={styles.notVerified}>
            <Alert
              dsVersion="2.0"
              type="warning"
              title="User not authenticated"
              message={
                resent
                  ? 'Verification email sent again. Open the link, then sign in.'
                  : 'Verify your email to sign in. Open the link we emailed when you signed up.'
              }
            />
            {!resent && (
              <Button
                variant="neutral"
                size="small"
                isFullWidth
                disabled={resend.isPending || cooldown.active}
                onClick={(e) => {
                  e.preventDefault();
                  onResend();
                }}
              >
                {resendButtonLabel}
              </Button>
            )}
          </div>
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
          error={loginFailed ? ' ' : undefined}
          required
          autoFocus
        />

        <PasswordTextInput
          dsVersion="2.0"
          label="Password"
          leadingIcon={<LockOutlined />}
          required
          value={password}
          error={loginFailed ? ' ' : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className={styles.row}>
          <Checkbox
            dsVersion="2.0"
            size="small"
            isChecked={keepSignedIn}
            onChange={(e) => setKeepSignedIn((e.target as HTMLInputElement).checked)}
          >
            Keep me signed in
          </Checkbox>
          {passwordResetEnabled && (
            <Button
              variant="progressive"
              type="inline"
              size="small"
              onClick={(e) => {
                e.preventDefault();
                navigate('/forgot-password');
              }}
            >
              Forgot password?
            </Button>
          )}
        </div>

        <Button
          dsVersion="2.0"
          htmlButtonType="submit"
          size="large"
          isFullWidth
          disabled={isLoggingIn}
        >
          {submitButtonLabel}
        </Button>
      </form>
    </AuthShell>
  );
}
