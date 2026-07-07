import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// `rbac auth-bg` (theme scope + the 3-stop radial-gradient backdrop, with a dark
// variant) stays in CSS — it isn't sensible as a Tailwind arbitrary value.
const styles = {
  card: 'w-[412px] max-w-[calc(100%_-_48px)] rounded-[20px] border border-[var(--line)] bg-[var(--panel-bg)] px-9 pb-[30px] pt-[34px] shadow-elevation-3-bottom',
  brand: 'mb-2 flex items-center gap-[11px]',
  logo: 'flex h-[38px] w-[38px] items-center justify-center rounded-2.5 bg-[var(--red-950)]',
  logoImage: 'h-6 w-6',
  word: 'font-[family-name:var(--font-family-display)] text-[18px] font-extrabold tracking-[-0.01em]',
  wordAccent: 'text-[var(--brand-educator)]',
};

export function AuthShell({
  children,
  foot,
  lead,
  cardClassName,
}: {
  children: ReactNode;
  foot?: ReactNode;
  // Rendered above the brand (e.g. a back button).
  lead?: ReactNode;
  // Extra classes on the card (e.g. a wider layout).
  cardClassName?: string;
}) {
  return (
    <div className="rbac auth-bg">
      <div className={cn(styles.card, cardClassName)}>
        {lead}
        <div className={styles.brand}>
          <div className={styles.logo}>
            <img className={styles.logoImage} src="/brand/ToddleLogo.svg" alt="" />
          </div>
          <div className={styles.word}>
            Toddle <span className={styles.wordAccent}>Compose</span>
          </div>
        </div>
        {children}
      </div>
      {foot && <div className="auth-foot">{foot}</div>}
    </div>
  );
}
