import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { TextInput, PasswordTextInput } from '@toddle-edu/ds-web';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useLogin } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const err = login.isError;

  const submit = () => {
    if (login.isPending) return;
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
          <label className="auth-check">
            <span className="cbx on">
              <Icon name="TickSmallOutlined" size={12} white />
            </span>
            Keep me signed in
          </label>
          <a>Forgot password?</a>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={login.isPending}
          onClick={submit}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
