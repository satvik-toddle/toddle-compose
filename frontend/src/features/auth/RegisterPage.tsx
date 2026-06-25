import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { PasswordStrength } from './PasswordStrength';
import { TextInput, PasswordTextInput, Alert, Button } from '@toddle-edu/ds-web';
import {
  UserProfileOutlined,
  EmailOutlined,
  LockOutlined,
  WarningTriangleOutlined,
} from '@toddle-edu/ds-icons';
import { useRegister } from '../../hooks/useAuthMutations';
import { messageOf } from '../../lib/errors';

const styles = {
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-5.5 text-body text-secondary',
  form: 'flex flex-col gap-4',
  errorText: 'flex items-center gap-1.5 text-body-s text-semantic-error',
  disclaimer: 'mt-1 text-center text-body-s text-secondary',
};

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isPasswordMismatched = confirmPassword.length > 0 && confirmPassword !== password;

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (register.isPending) return 'Creating account…';
    return 'Create account';
  }, [register.isPending]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPasswordMismatched || register.isPending) return;
    register.mutate(
      { name, email, password },
      {
        onSuccess: (res) =>
          navigate('/register/check-email', {
            state: { email: res.email, emailDelivered: res.emailDelivered },
          }),
      },
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
      <h1 className={styles.heading}>Create your account</h1>
      <p className={styles.subheading}>One identity for every workspace you're invited to.</p>

      <form className={styles.form} onSubmit={onSubmit}>
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
          leadingIcon={<UserProfileOutlined />}
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
          leadingIcon={<EmailOutlined />}
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
          leadingIcon={<LockOutlined />}
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
          leadingIcon={<LockOutlined />}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={isPasswordMismatched ? ' ' : undefined}
          required
          onTrailingIconClick={(e) => e.preventDefault()}
        />

        {isPasswordMismatched && (
          <span className={styles.errorText}>
            <WarningTriangleOutlined variant="critical" size="xxx-small" />
            Passwords don't match.
          </span>
        )}

        <Button size="large" isFullWidth disabled={register.isPending}>
          {submitButtonLabel}
        </Button>

        <p className={styles.disclaimer}>
          By continuing you agree to Toddle's Terms and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}
