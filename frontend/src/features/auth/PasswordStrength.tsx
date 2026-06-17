import { cn } from '../../lib/cn';
import s from './PasswordStrength.module.scss';

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
    <div className={s.pwStrength}>
      <span className={cn(s.bar, s.s1, score >= 1 && s.on)} />
      <span className={cn(s.bar, s.s2, score >= 2 && s.on)} />
      <span className={cn(s.bar, s.s3, score >= 3 && s.on)} />
      <span className={cn(s.bar, score >= 4 && s.on)} />
      <span className={s.pwLabel}>{LABELS[score]}</span>
    </div>
  );
}
