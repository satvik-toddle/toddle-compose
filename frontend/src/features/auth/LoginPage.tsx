import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useLogin } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
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
        <Field label="Email">
          <TextInput
            icon="EmailOutlined"
            type="email"
            placeholder="you@toddle.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            err={err}
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <TextInput
            type={showPw ? 'text' : 'password'}
            icon="LockOutlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            err={err}
            required
            trailing={<Icon name="EyeOutlined" size={14} muted />}
            onTrailingClick={() => setShowPw((v) => !v)}
          />
        </Field>
        <div className="auth-row">
          <label className="auth-check">
            <span className="cbx on">
              <Icon name="TickSmallOutlined" size={12} white />
            </span>
            Keep me signed in
          </label>
          <a>Forgot password?</a>
        </div>
        <Button type="submit" variant="primary" size="lg" block disabled={login.isPending} onClick={submit}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
