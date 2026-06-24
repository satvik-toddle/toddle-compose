import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { TextInput, PasswordTextInput, Checkbox, Button, Alert } from '@toddle-edu/ds-web';
import { EmailOutlined, LockOutlined } from '@toddle-edu/ds-icons';
import { useLogin } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

const styles = {
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-5.5 text-body text-secondary',
  form: 'flex flex-col gap-4',
  row: 'flex items-center justify-between text-body-s',
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const loginFailed = login.isError;
  const isLoggingIn = login.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    login.mutate({ email, password }, { onSuccess: () => navigate('/') });
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
        {loginFailed && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(login.error, "That email and password don't match. Try again.")}
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
          onTrailingIconClick={(e) => e.preventDefault()}
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
          <Button
            variant="progressive"
            type="inline"
            size="small"
            onClick={(e) => e.preventDefault()}
          >
            Forgot password?
          </Button>
        </div>

        <Button size="large" isFullWidth disabled={isLoggingIn}>
          {isLoggingIn ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
