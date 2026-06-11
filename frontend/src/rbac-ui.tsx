/* ==================================================================
   RBAC UI KIT — shared primitives for every RBAC / workspace surface.
   A TypeScript port of the design bundle's rbac-kit.jsx, wired to use
   real DS svg assets served from /ds and the backend's UPPERCASE role
   enums (OWNER/MAINTAINER/MEMBER · READ/COMMENT/EDIT/ADMIN).
   ================================================================== */
import type { CSSProperties, ReactNode } from 'react';

/* outlined icon as an <img src>; tinted in CSS via filters */
export const ic = (name: string) => `/ds/assets/icons/outlined/${name}.svg`;
export const LOGO_SRC = '/ds/assets/logo/ToddleLogo.svg';

/* brand avatar palette (from the design brief) */
export const BRAND = [
  '#5a5ae2', '#00ac8a', '#ef4371', '#d67d00', '#6d9c00',
  '#00b0c2', '#b646ee', '#e8653a', '#a43dd7', '#f04c54',
];

/* deterministic color + initials for any person, so a real user list
   gets the same vivid avatars the static mockups used */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BRAND[h % BRAND.length];
}
export function initials(name?: string, email?: string): string {
  const src = (name || '').trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

/* per-workspace emoji + tint, stable across renders */
const WS_EMOJIS = ['🚀', '🛠️', '🎨', '📣', '🌱', '📈', '🔬', '📚', '💡', '🧭', '🗂️', '⚡'];
export function wsEmoji(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) >>> 0;
  return WS_EMOJIS[h % WS_EMOJIS.length];
}
export function wsTintStyle(seed: string): CSSProperties {
  const c = colorFor(seed);
  return { background: c + '22', boxShadow: `inset 0 0 0 1px ${c}44` };
}

/* ---- role metadata (UPPERCASE keys = backend enum values) ---- */
export type RealmRole = 'OWNER' | 'MAINTAINER' | 'MEMBER';
export type WsRole = 'READ' | 'COMMENT' | 'EDIT' | 'ADMIN';

export const REALM_ROLE: Record<RealmRole, { label: string; icon: string; cls: string }> = {
  OWNER: { label: 'Owner', icon: 'StarOutlined', cls: 'owner' },
  MAINTAINER: { label: 'Maintainer', icon: 'BoltOutlined', cls: 'maintainer' },
  MEMBER: { label: 'Member', icon: 'UserProfileOutlined', cls: 'member' },
};
export const WS_ROLE: Record<WsRole, { label: string; icon: string; ds: string; cls: string }> = {
  READ: { label: 'Read', icon: 'EyeOutlined', ds: 'View pages only', cls: 'read' },
  COMMENT: { label: 'Comment', icon: 'CommentOutlined', ds: 'View and comment', cls: 'comment' },
  EDIT: { label: 'Edit', icon: 'PencilOutlined', ds: 'Create and edit pages', cls: 'edit' },
  ADMIN: { label: 'Admin', icon: 'SettingsOutlined', ds: 'Manage members & settings', cls: 'admin' },
};
export const REALM_ROLE_OPTIONS: RealmRole[] = ['MEMBER', 'MAINTAINER']; // OWNER is seeded
export const WS_ROLE_OPTIONS: WsRole[] = ['READ', 'COMMENT', 'EDIT', 'ADMIN'];

/* normalize whatever the API returns into our enum keys */
export const asRealmRole = (r?: string): RealmRole =>
  (REALM_ROLE[(r || '').toUpperCase() as RealmRole] ? (r!.toUpperCase() as RealmRole) : 'MEMBER');
export const asWsRole = (r?: string): WsRole => {
  const k = (r || '').toUpperCase();
  if (k === 'OWNER') return 'ADMIN'; // workspace owner ≈ admin in this UI
  return WS_ROLE[k as WsRole] ? (k as WsRole) : 'READ';
};

/* ------------------------------------------------------------------ */
/* Primitives                                                         */
/* ------------------------------------------------------------------ */
export type Person = { name?: string; email?: string; color?: string; initials?: string };

export function Avatar({
  person, c, children, size = 26, ring = false, style,
}: {
  person?: Person; c?: string; children?: ReactNode; size?: number; ring?: boolean; style?: CSSProperties;
}) {
  const seed = person?.email || person?.name || 'x';
  const bg = c || person?.color || colorFor(seed);
  const txt = children || person?.initials || initials(person?.name, person?.email);
  return (
    <span
      className={'av' + (ring ? ' av-ring' : '')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: bg, ...style }}
    >
      {txt}
    </span>
  );
}

export function AvStack({ people, size = 24, max = 4 }: { people: Person[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="av-stack">
      {shown.map((p, i) => <Avatar key={i} person={p} size={size} ring />)}
      {extra > 0 && (
        <span
          className="av av-ring"
          style={{
            width: size, height: size, fontSize: Math.round(size * 0.36),
            background: 'var(--surface-tertiary-enabled)', color: 'var(--text-secondary)',
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* Realm role chip — solid / authoritative */
export function RealmChip({ role, sm }: { role: RealmRole; sm?: boolean }) {
  const r = REALM_ROLE[role];
  return (
    <span className={'rchip ' + r.cls} style={sm ? { height: 18, fontSize: 10, padding: '0 7px' } : undefined}>
      <img className="ic-12" src={ic(r.icon)} alt="" />{r.label}
    </span>
  );
}

/* Workspace role chip — soft tinted; `overlay` = realm admin acting as ws admin */
export function WSChip({ role, overlay, sm }: { role?: WsRole; overlay?: boolean; sm?: boolean }) {
  if (overlay) {
    return (
      <span
        className="wchip overlay"
        style={sm ? { height: 18, fontSize: 10 } : undefined}
        title="Realm admins act as Admin in every workspace"
      >
        <img className="ic-12" src={ic('SettingsOutlined')} alt="" />Admin · via realm
      </span>
    );
  }
  const r = WS_ROLE[role || 'READ'];
  return (
    <span className={'wchip ' + r.cls} style={sm ? { height: 18, fontSize: 10 } : undefined}>
      <img className="ic-12" src={ic(r.icon)} alt="" />{r.label}
    </span>
  );
}

export function Btn({
  variant = '', size = '', icon, iconRight, children, disabled, className = '', style, title, onClick, type,
}: {
  variant?: '' | 'primary' | 'danger' | 'ghost';
  size?: '' | 'sm' | 'lg';
  icon?: string; iconRight?: string; children?: ReactNode; disabled?: boolean;
  className?: string; style?: CSSProperties; title?: string;
  onClick?: () => void; type?: 'button' | 'submit';
}) {
  const cls = ['btn', variant, size, className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled} style={style} title={title} onClick={onClick} type={type || 'button'}>
      {icon && <img className="ic-14" src={ic(icon)} alt="" />}
      {children}
      {iconRight && <img className="ic-14 ic-muted" src={ic(iconRight)} alt="" />}
    </button>
  );
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Input({
  icon, placeholder, value, onChange, type, err, sm, trailing, autoFocus, onKeyDown,
}: {
  icon?: string; placeholder?: string; value?: string; onChange?: (v: string) => void;
  type?: string; err?: boolean; sm?: boolean; trailing?: ReactNode; autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <span className={'inp' + (sm ? ' sm' : '') + (err ? ' err' : '')}>
      {icon && <img className="ic-14 ic-muted" src={ic(icon)} alt="" />}
      <input
        type={type || 'text'}
        placeholder={placeholder}
        value={value ?? ''}
        autoFocus={autoFocus}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onKeyDown={onKeyDown}
        readOnly={!onChange}
      />
      {trailing}
    </span>
  );
}

/* Inline role dropdown: shows the design's chip + chevron, with a transparent
   native <select> overlaid across the whole control (styled in rbac.css). */
export function RoleDropdown({
  kind, value, options, onChange, locked,
}: {
  kind: 'realm' | 'ws';
  value: string;
  options: string[];
  onChange: (v: string) => void;
  locked?: boolean;
}) {
  const chip = kind === 'realm'
    ? <RealmChip role={value as RealmRole} />
    : <WSChip role={value as WsRole} />;
  if (locked) return <span className="role-dd locked">{chip}</span>;
  const label = (o: string) => (kind === 'realm' ? REALM_ROLE[o as RealmRole]?.label : WS_ROLE[o as WsRole]?.label) || o;
  return (
    <span className="role-dd role-select">
      {chip}
      <img className="ic-14" src={ic('ChevronDownOutlined')} alt="" />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    </span>
  );
}

/* Account menu pill in the appbar */
export function AcctPill({
  me, role, onSignOut,
}: {
  me: { name?: string; email?: string }; role?: RealmRole; onSignOut?: () => void;
}) {
  return (
    <span className="acct" onClick={onSignOut} title={onSignOut ? 'Sign out' : undefined} style={onSignOut ? { cursor: 'pointer' } : undefined}>
      <Avatar person={{ name: me.name, email: me.email }} size={28} />
      <span className="who">
        <span className="nm">{me.name || me.email}</span>
        {role && <span className="sub">{REALM_ROLE[role].label}</span>}
      </span>
      <img className="ic-14 ic-muted" src={ic('ChevronDownOutlined')} alt="" style={{ marginRight: 2 }} />
    </span>
  );
}

/* Post-login top bar */
export function AppBar({
  realm = 'Toddle', sub = 'Realm', me, role, left, right, onSignOut,
}: {
  realm?: string; sub?: string; me?: { name?: string; email?: string }; role?: RealmRole;
  left?: ReactNode; right?: ReactNode; onSignOut?: () => void;
}) {
  return (
    <div className="appbar">
      <div className="brand">
        <div className="logo"><img src={LOGO_SRC} alt="" /></div>
        <div className="realm">
          <div className="nm">{realm}</div>
          <div className="sub">{sub}</div>
        </div>
      </div>
      {left}
      <div className="gap" />
      {right}
      {me && <AcctPill me={me} role={role} onSignOut={onSignOut} />}
    </div>
  );
}

/* Generic modal shell rendered over a dimmed/blurred backdrop */
export function Overlay({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="scrim" onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      {children}
    </div>
  );
}

export function ModalHead({
  tone = 'neutral', icon, title, sub, onClose,
}: {
  tone?: 'neutral' | 'danger' | 'brand'; icon: string; title: ReactNode; sub?: ReactNode; onClose?: () => void;
}) {
  const toneBg =
    tone === 'danger' ? 'var(--surface-semantic-error)'
    : tone === 'brand' ? 'var(--red-950)'
    : 'var(--surface-secondary-enabled)';
  const imgFilter =
    tone === 'neutral'
      ? 'invert(48%) sepia(0%) saturate(0%) brightness(95%)'
      : 'invert(38%) sepia(83%) saturate(2046%) hue-rotate(327deg) brightness(94%)';
  return (
    <div className="m-head">
      <span className="m-ic" style={{ background: toneBg }}>
        <img className="ic-18" style={{ filter: imgFilter }} src={ic(icon)} alt="" />
      </span>
      <div style={{ flex: 1 }}>
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
      <button className="ibtn x" onClick={onClose}><img className="ic-18 ic-muted" src={ic('CloseOutlined')} alt="" /></button>
    </div>
  );
}
