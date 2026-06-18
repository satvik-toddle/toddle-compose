import type { ReactNode } from 'react';

export function AuthShell({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="rbac auth-bg">
      <div className="auth-card">
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
