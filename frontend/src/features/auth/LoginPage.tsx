import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { TextInput, PasswordTextInput, Checkbox, Button } from '@toddle-edu/ds-web';
import { Icon } from '../../components/Icon';
import { useLogin } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const err = login.isError;
  const isLoggingIn = login.isPending;

  const submit = () => {
    if (isLoggingIn) return;
    login.mutate({ email, password }, { onSuccess: () => navigate('/') });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <AuthShell
      foot={
        <span>
          New to Toddle Compose? <Link to="/register">Create an account</Link>
        </span>
      }
    >
      <h1 className="auth-h">Welcome back</h1>
      <p className="auth-p">Sign in to reach your workspaces.</p>

      {err && (
        <div className="auth-banner err">
          <Icon name="WarningTriangleOutlined" size={14} />
          {messageOf(login.error, "That email and password don't match. Try again.")}
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit}>
        <TextInput
          dsVersion="2.0"
          label="Email"
          leadingIcon={<Icon name="EmailOutlined" size={14} muted />}
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="you@toddle.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={err ? ' ' : undefined}
          required
          autoFocus
        />
        <PasswordTextInput
          dsVersion="2.0"
          label="Password"
          leadingIcon={<Icon name="LockOutlined" size={14} muted />}
          required
          value={password}
          error={err ? ' ' : undefined}
          onChange={(e) => setPassword(e.target.value)}
          onTrailingIconClick={(e) => e.preventDefault()}
        />

        <div className="auth-row">
          <Checkbox
            dsVersion="2.0"
            size="small"
            isChecked={keepSignedIn}
            onChange={(e) => setKeepSignedIn((e.target as HTMLInputElement).checked)}
          >
            Keep me signed in
          </Checkbox>
          <Button variant="progressive" type="inline" size="small">
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
