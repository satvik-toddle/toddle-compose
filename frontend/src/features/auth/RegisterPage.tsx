import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { PasswordStrength } from './PasswordStrength';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useRegister } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = () => {
    if (mismatch || register.isPending) return;
    register.mutate({ name, email, password }, { onSuccess: () => navigate('/register/success') });
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <AuthShell
      foot={
        <span>
          Already have an account? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <h1 className="auth-h">Create your account</h1>
      <p className="auth-p">One identity for every workspace you're invited to.</p>

      {register.isError && (
        <div className="auth-banner err">
          <Icon name="WarningTriangleOutlined" size={14} />
          {messageOf(register.error, 'Could not create your account. Try again.')}
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit}>
        <Field label="Full name">
          <TextInput
            icon="UserProfileOutlined"
            placeholder="Jamie Rivera"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Work email">
          <TextInput
            icon="EmailOutlined"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            icon="LockOutlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </Field>
        <PasswordStrength password={password} />
        <Field label="Confirm password">
          <TextInput
            type="password"
            icon="LockOutlined"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            err={mismatch}
            required
          />
        </Field>
        {mismatch && <span className="err-text"><Icon name="WarningTriangleOutlined" size={14} />Passwords don't match.</span>}
        <Button type="submit" variant="primary" size="lg" block disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="auth-fine">By continuing you agree to Toddle's Terms and Privacy Policy.</p>
      </form>
    </AuthShell>
  );
}
