import { cn } from '../../lib/cn';

// 0–4 score from length + character-class variety.
export function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  if (!password) return null;
  return (
    <div className="pw-strength">
      <span className={cn('bar', 's1', score >= 1 && 'on')} />
      <span className={cn('bar', 's2', score >= 2 && 'on')} />
      <span className={cn('bar', 's3', score >= 3 && 'on')} />
      <span className={cn('bar', score >= 4 && 'on')} />
      <span className="pw-label">{LABELS[score]}</span>
    </div>
  );
}
