import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { performLogout } from '../lib/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { RealmChip } from './RealmChip';
import type { User } from '../types/api';
import type { RealmRole } from '../types/roles';
import { REALM_ROLE_META } from '../lib/roles';

// Account pill + dropdown (name, email, realm role badge, sign out). `compact`
// renders the workspace-topbar variant (avatar + chevron only).
export function AcctPill({
  me,
  realmRole,
  compact,
}: {
  me: User;
  realmRole?: RealmRole | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const signOut = async () => {
    await performLogout(qc);
    navigate('/login');
  };

  return (
    <div className="acct-wrap" ref={ref}>
      <button
        type="button"
        className={compact ? 'ws-acct' : 'acct'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar person={{ name: me.name, color: me.color }} size={compact ? 30 : 28} />
        {!compact && (
          <span className="who">
            <span className="nm">{me.name}</span>
            {realmRole && <span className="sub">{REALM_ROLE_META[realmRole].label}</span>}
          </span>
        )}
        <Icon name="ChevronDownOutlined" size={14} muted style={{ marginRight: compact ? 0 : 2 }} />
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="am-head">
            <div className="nm">{me.name}</div>
            <div className="sub">{me.email}</div>
            {realmRole && (
              <div style={{ marginTop: 8 }}>
                <RealmChip role={realmRole} sm />
              </div>
            )}
          </div>
          <button type="button" className="am-row" role="menuitem" onClick={signOut}>
            <Icon name="ChevronLeftOutlined" size={14} muted />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
