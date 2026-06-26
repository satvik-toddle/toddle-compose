import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

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
      <div className={cn('auth-card', cardClassName)}>
        {lead}
        <div className="auth-brand">
          <div className="auth-logo">
            <img src="/brand/ToddleLogo.svg" alt="" />
          </div>
          <div className="auth-word">
            Toddle <span>Compose</span>
          </div>
        </div>
        {children}
      </div>
      {foot && <div className="auth-foot">{foot}</div>}
    </div>
  );
}
