import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { PasswordStrength } from './PasswordStrength';
import { TextInput, PasswordTextInput, Alert, Button } from '@toddle-edu/ds-web';
import { Icon } from '../../components/Icon';
import { useRegister } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isPasswordMismatched = confirmPassword.length > 0 && confirmPassword !== password;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPasswordMismatched || register.isPending) return;
    register.mutate(
      { name, email, password },
      { onSuccess: () => navigate('/register/success') },
    );
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

      <form className="auth-form" onSubmit={onSubmit}>
        {register.isError && (
          <Alert
            dsVersion="2.0"
            type="error"
            message={messageOf(register.error, 'Could not create your account. Try again.')}
          />
        )}

        <TextInput
          dsVersion="2.0"
          label="Full name"
          leadingIcon={<Icon name="UserProfileOutlined" size={14} muted />}
          type="text"
          placeholder="Jamie Rivera"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <TextInput
          dsVersion="2.0"
          label="Work email"
          leadingIcon={<Icon name="EmailOutlined" size={14} muted />}
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordTextInput
          dsVersion="2.0"
          label="Password"
          leadingIcon={<Icon name="LockOutlined" size={14} muted />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          onTrailingIconClick={(e) => e.preventDefault()}
        />
        <PasswordStrength password={password} />
        <PasswordTextInput
          dsVersion="2.0"
          label="Confirm password"
          leadingIcon={<Icon name="LockOutlined" size={14} muted />}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={isPasswordMismatched ? ' ' : undefined}
          required
          onTrailingIconClick={(e) => e.preventDefault()}
        />
        
        {isPasswordMismatched && <span className="err-text"><Icon name="WarningTriangleOutlined" size={14} />Passwords don't match.</span>}

        <Button size="large" isFullWidth disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
        
        <p className="auth-fine">By continuing you agree to Toddle's Terms and Privacy Policy.</p>
      </form>
    </AuthShell>
  );
}
