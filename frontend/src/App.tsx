import { useEffect, useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, asRows, getToken, setToken, setRefresh, getRefresh, type ApiError } from './api';
// Lazy-load the two collaborative surfaces so each page pulls in only the yjs
// it needs: the editor bundles its own yjs, the sheet uses the app's. Eagerly
// importing both put two yjs copies on every page ("Yjs was already imported").
const DocView = lazy(() => import('./DocView').then((m) => ({ default: m.DocView })));
const SheetView = lazy(() => import('./SheetView').then((m) => ({ default: m.SheetView })));
import { DataGridView } from './DataGridView';
import {
  ic, LOGO_SRC, Avatar, AvStack, RealmChip, WSChip, Btn, Field, Input, RoleDropdown,
  AppBar, ModalHead, REALM_ROLE, WS_ROLE, REALM_ROLE_OPTIONS, WS_ROLE_OPTIONS,
  asRealmRole, asWsRole, wsEmoji, wsTintStyle, colorFor,
  type RealmRole, type WsRole, type Person,
} from './rbac-ui';

type Me = { id: string; email: string; name?: string; color?: string } | null;
type Log = { ok: boolean; label: string; status?: number; data: any } | null;

/* Mirrors the design flow (Workspace RBAC.html):
   1 Auth (login / register → awaiting access)
   2 Workspace launcher (cards + request access + empty states)
   3 Realm admin console (Workspaces / Members / Join requests)
   4 Inside a workspace (folder tree, docs, members, requests, switcher)
   5 Modals + permission/error states                                   */

export function App() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [token, setTok] = useState<string | null>(getToken());
  const [me, setMe] = useState<Me>(null);
  const [realm, setRealm] = useState<any>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [log, setLog] = useState<Log>(null);

  const call = useCallback(async (label: string, fn: () => Promise<any>) => {
    try {
      const data = await fn();
      setLog({ ok: true, label, data });
      return data;
    } catch (e) {
      const err = e as ApiError;
      setLog({ ok: false, label, status: err.status, data: err.data });
      throw e;
    }
  }, []);

  const loadIdentity = useCallback(() => {
    if (!getToken()) return;
    call('GET /auth/me', () => api('/auth/me'))
      .then((d) => { const u = d?.user ?? d; setMe(u ? { ...u, color: colorFor(u.email || u.id) } : null); })
      .catch(() => {});
    call('GET /realm', () => api('/realm')).then(setRealm).catch(() => {});
  }, [call]);

  useEffect(() => { loadIdentity(); }, [token, loadIdentity]);

  useEffect(() => {
    if (token && (loc.pathname === '/' || loc.pathname === '')) navigate('/workspaces', { replace: true });
  }, [token, loc.pathname, navigate]);

  // api.ts fires this when a refresh fails (refresh token expired/revoked) → drop to login.
  useEffect(() => {
    const onExpired = () => { setTok(null); setMe(null); setRealm(null); setAwaiting(false); navigate('/workspaces'); };
    window.addEventListener('tc-auth-expired', onExpired);
    return () => window.removeEventListener('tc-auth-expired', onExpired);
  }, [navigate]);

  // access token only (enter/leave/refresh keep the existing refresh token)
  function setSession(t: string | null) { setToken(t); setTok(t); }
  function logout() {
    const rt = getRefresh();
    if (rt) api('/auth/logout', { method: 'POST', auth: false, body: { refreshToken: rt } }).catch(() => {});
    setRefresh(null); setSession(null); setMe(null); setRealm(null); setAwaiting(false); navigate('/workspaces');
  }
  function enterWs(id: string, t: string) { setSession(t); navigate(`/ws/${encodeURIComponent(id)}`); }
  function leaveWs() {
    call('POST /auth/workspace/leave', () => api('/auth/workspace/leave', { method: 'POST' }))
      .then((d) => { setSession(d.accessToken); navigate('/workspaces'); })
      .catch(() => navigate('/workspaces'));
  }
  function switchWs(id: string) {
    call('POST /auth/workspace/enter', () => api('/auth/workspace/enter', { method: 'POST', body: { workspaceId: id } }))
      .then((d: any) => enterWs(id, d.accessToken)).catch(() => {});
  }

  // Temporary standalone mount of @toddle-edu/ds-data-grid (no auth needed yet).
  // Reach it at /data-grid; same linked-package approach as the doc-editor.
  if (loc.pathname === '/data-grid')
    return <DataGridView onBack={() => navigate(token ? '/workspaces' : '/')} />;

  // 1 · Auth
  if (!token)
    return <Auth call={call} onAuthed={(d, registered) => { setRefresh(d.refreshToken ?? null); setSession(d.accessToken); setAwaiting(registered); navigate('/workspaces'); }} />;
  // 1b · awaiting access (just registered)
  if (awaiting)
    return <Awaiting me={me} onContinue={() => setAwaiting(false)} onSignOut={logout} />;

  const realmRole: RealmRole = asRealmRole(realm?.role);
  const isAdmin = realmRole === 'OWNER' || realmRole === 'MAINTAINER';
  const bar = { realm, me, realmRole, onSignOut: logout };

  const wsMatch = loc.pathname.match(/^\/ws\/([^/]+)(?:\/doc\/([^/]+))?/);
  const activeWs = wsMatch ? decodeURIComponent(wsMatch[1]) : null;
  const openDocId = wsMatch && wsMatch[2] ? decodeURIComponent(wsMatch[2]) : null;

  if (loc.pathname === '/admin' && isAdmin)
    return <AdminScreen call={call} bar={bar} me={me} realmRole={realmRole} onBack={() => navigate('/workspaces')} log={log} />;
  if (activeWs)
    return (
      <WorkspaceScreen
        call={call} bar={bar} wsId={activeWs} me={me} realmRole={realmRole} isRealmAdmin={isAdmin}
        openDocId={openDocId}
        onOpenDoc={(d: string) => navigate(`/ws/${encodeURIComponent(activeWs)}/doc/${encodeURIComponent(d)}`)}
        onCloseDoc={() => navigate(`/ws/${encodeURIComponent(activeWs)}`)}
        onLeave={leaveWs} onSwitch={switchWs} onAdmin={() => navigate('/admin')} log={log}
      />
    );
  // 2 · Workspace launcher — forced landing on every sign-in
  return <Launcher call={call} bar={bar} me={me} realmRole={realmRole} isAdmin={isAdmin} onEnter={switchWs} onAdmin={() => navigate('/admin')} log={log} />;
}

/* ====================== shared helpers ====================== */
function useList(call: any, path: string | null, deps: any[] = []) {
  const [rows, setRows] = useState<any[]>([]);
  const refresh = useCallback(() => {
    if (!path) return;
    call(`GET ${path}`, () => api(path)).then((d: any) => setRows(asRows(d))).catch(() => {});
  }, [call, path]);
  useEffect(() => { refresh(); }, [refresh, ...deps]);
  return { rows, refresh, setRows };
}

const email_ = (r: any) => r.email ?? r.user?.email ?? r.userEmail ?? '';
const name_ = (r: any) => r.name ?? r.user?.name ?? '';
const userId_ = (r: any) => r.userId ?? r.user?.id ?? r.id ?? '';
const personOf = (r: any): Person => ({ name: name_(r) || undefined, email: email_(r) || undefined });
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

/* centered modal over a dimmed backdrop of the current screen */
function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')}>{children}</div>
    </div>
  );
}

/* ============================== 1 · Auth ============================== */
function Auth({ call, onAuthed }: { call: any; onAuthed: (d: any, registered: boolean) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('owner@toddle.test');
  const [password, setPassword] = useState('password123');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isReg = mode === 'register';
  const strength = Math.min(3, Math.floor(password.length / 4));
  const strengthLabel = ['Too short', 'Weak', 'Okay', 'Strong'][strength];

  async function submit() {
    setErr(null);
    const path = isReg ? '/auth/register' : '/auth/login';
    const body = isReg ? { email, password, name } : { email, password };
    try {
      const d = await call(`POST ${path}`, () => api(path, { method: 'POST', body, auth: false }));
      if (d?.accessToken) onAuthed(d, isReg);
    } catch (e) {
      const status = (e as ApiError)?.status;
      setErr(isReg ? 'Could not create the account. Try a different email.'
        : status === 401 ? 'That email and password don’t match. Try again.'
        : 'Sign-in failed. Check the response panel below.');
    }
  }

  return (
    <div className="rbac auth-bg">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo"><img src={LOGO_SRC} alt="" /></div>
          <div className="auth-word">Toddle <span>Compose</span></div>
        </div>
        <h1 className="auth-h">{isReg ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-p">{isReg ? 'One identity for every workspace you’re invited to.' : 'Sign in to reach your workspaces.'}</p>

        {err && (
          <div className="auth-banner err">
            <img className="ic-14" src={ic('WarningTriangleOutlined')} alt="" />{err}
          </div>
        )}

        <div className="auth-form">
          {isReg && (
            <Field label="Full name">
              <Input icon="UserProfileOutlined" placeholder="Jamie Rivera" value={name} onChange={setName} />
            </Field>
          )}
          <Field label={isReg ? 'Work email' : 'Email'}>
            <Input icon="EmailOutlined" placeholder="you@toddle.com" value={email} onChange={setEmail} err={!!err && !isReg} />
          </Field>
          <Field label="Password">
            <Input
              type={show ? 'text' : 'password'} icon="LockOutlined" value={password} onChange={setPassword}
              err={!!err && !isReg}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isReg) submit(); }}
              trailing={
                <button className="ibtn sm" type="button" onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'}>
                  <img className="ic-14 ic-muted" src={ic('EyeOutlined')} alt="" />
                </button>
              }
            />
          </Field>
          {isReg && (
            <>
              <div className="pw-strength">
                <span className={'bar s1' + (strength >= 1 ? ' on' : '')} />
                <span className={'bar s2' + (strength >= 2 ? ' on' : '')} />
                <span className={'bar s3' + (strength >= 3 ? ' on' : '')} />
                <span className="bar" />
                <span className="pw-label">{strengthLabel}</span>
              </div>
              <Field label="Confirm password">
                <Input type="password" icon="LockOutlined" value={confirm} onChange={setConfirm} />
              </Field>
            </>
          )}
          {!isReg && (
            <div className="auth-row">
              <label className="auth-check"><span className="cbx on"><img className="ic-12" src={ic('TickSmallOutlined')} alt="" /></span>Keep me signed in</label>
              <a>Forgot password?</a>
            </div>
          )}
          <Btn variant="primary" size="lg" className="block" onClick={submit}>{isReg ? 'Create account' : 'Sign in'}</Btn>
          {isReg && <p className="auth-fine">By continuing you agree to Toddle’s Terms and Privacy Policy.</p>}
        </div>
      </div>
      <div className="auth-foot">
        {isReg
          ? <span>Already have an account? <a onClick={() => { setMode('login'); setErr(null); }}>Sign in</a></span>
          : <span>New to Toddle Compose? <a onClick={() => { setMode('register'); setErr(null); }}>Create an account</a></span>}
      </div>
    </div>
  );
}

function Awaiting({ me, onContinue, onSignOut }: { me: Me; onContinue: () => void; onSignOut: () => void }) {
  const first = (me?.name || '').split(' ')[0];
  return (
    <div className="rbac auth-bg">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo"><img src={LOGO_SRC} alt="" /></div>
          <div className="auth-word">Toddle <span>Compose</span></div>
        </div>
        <div className="auth-success">
          <div className="suc-glyph"><img className="ic-24" src={ic('TickCircleOutlined')} alt="" /></div>
          <h1 className="auth-h" style={{ marginTop: 4 }}>You’re all set{first ? `, ${first}` : ''}</h1>
          <p className="auth-p" style={{ maxWidth: 360 }}>
            Your account is created. An <b>admin needs to add you to a workspace</b> before you can start —
            or find a public one to join.
          </p>
          <div className="suc-wait"><span className="pulse" />Waiting to be added to a workspace</div>
          <Btn variant="primary" className="block" icon="SearchOutlined" style={{ marginTop: 6 }} onClick={onContinue}>Find a workspace to join</Btn>
          <p className="auth-fine">Signed in as <b>{me?.email}</b></p>
        </div>
      </div>
      <div className="auth-foot"><a onClick={onSignOut}>Sign out</a></div>
    </div>
  );
}

/* ====================== 2 · Workspace launcher ====================== */
function Launcher({ call, bar, me, realmRole, isAdmin, onEnter, onAdmin, log }: any) {
  const mine = useList(call, '/workspaces');
  const disc = useList(call, '/workspaces/discoverable');
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const canCreate = isAdmin;

  const isPublic = (w: any) => (w.visibility || '').toUpperCase() === 'PUBLIC';
  function join(id: string) { call(`POST /workspaces/${id}/join`, () => api(`/workspaces/${id}/join`, { method: 'POST' })).then(() => onEnter(id)).catch(() => {}); }
  function request(id: string) { call(`POST /workspaces/${id}/requests`, () => api(`/workspaces/${id}/requests`, { method: 'POST', body: {} })).then(() => setRequested((r) => ({ ...r, [id]: true }))).catch(() => {}); }

  const count = mine.rows.length;
  return (
    <div className="rbac">
      <AppBar realm={bar.realm?.name || 'Toddle'} sub="Realm" me={me} role={realmRole} onSignOut={bar.onSignOut}
        right={isAdmin && <Btn icon="DashboardOutlined" onClick={onAdmin}>Admin console</Btn>} />
      <div className="page">
        <div className="page-wrap">
          <div className="lc-greet">
            <div>
              <h1>{greet()}{me?.name ? `, ${me.name.split(' ')[0]}` : ''}</h1>
              <div className="sub">You can reach <b>{count}</b> {count === 1 ? 'workspace' : 'workspaces'} in Toddle · signed in as {me?.email}</div>
            </div>
            <div className="lc-greet-actions">
              {canCreate && <Btn variant="primary" icon="AddOutlined" onClick={() => setShowCreate(true)}>New workspace</Btn>}
            </div>
          </div>

          {isAdmin && (
            <div className="lc-note">
              <img className="ic-14 ic-muted" src={ic('InformationOutlined')} alt="" />
              As a realm {REALM_ROLE[realmRole as RealmRole].label.toLowerCase()}, you can enter <b>any</b> workspace and act as its Admin.
            </div>
          )}

          {count === 0 && !canCreate ? (
            <div className="empty">
              <span className="glyph" style={{ background: 'var(--surface-secondary-enabled)' }}>🪪</span>
              <h2>You’re not in any workspaces yet</h2>
              <p>Your account is ready. Ask a realm admin to add you, or request access to a workspace below.</p>
              <div className="lc-waitcard">
                <Avatar person={{ name: me?.name, email: me?.email }} size={30} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{me?.name || me?.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{me?.email} · <RealmChip role={realmRole} sm /></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="lc-grid">
              {mine.rows.map((w: any) => {
                const sharedPeople: Person[] = Array.from({ length: Math.min(4, w.memberCount || w.members || 1) }, () => ({}));
                return (
                  <div key={w.id} className="ws-card" onClick={() => onEnter(w.id)}>
                    <div className="ws-card-top">
                      <span className="ws-emoji" style={wsTintStyle(w.id)}>{w.icon || wsEmoji(w.id)}</span>
                      {isAdmin ? <WSChip overlay sm /> : <WSChip role={asWsRole(w.role)} sm />}
                    </div>
                    <div className="ws-card-nm">{w.name}</div>
                    <div className="ws-card-meta">
                      <span><img className="ic-14 ic-muted" src={ic('MultipleUsersOutlined')} alt="" />{w.memberCount ?? w.members ?? '—'} members</span>
                      {isPublic(w) && <span><img className="ic-14 ic-muted" src={ic('GlobeOutlined')} alt="" />Public</span>}
                    </div>
                    <div className="ws-card-foot">
                      <AvStack people={sharedPeople} size={22} max={4} />
                      <span className="enter">Enter<img className="ic-14" src={ic('ChevronRightOutlined')} alt="" /></span>
                    </div>
                  </div>
                );
              })}
              {canCreate && (
                <button className="ws-card add" onClick={() => setShowCreate(true)}>
                  <span className="add-glyph"><img className="ic-20 ic-muted" src={ic('AddOutlined')} alt="" /></span>
                  <span className="add-nm">New workspace</span>
                  <span className="add-ds">Create a space and invite your team</span>
                </button>
              )}
            </div>
          )}

          {disc.rows.length > 0 && (
            <>
              <h2 className="ws-card-nm" style={{ margin: '34px 0 4px' }}>Discover workspaces</h2>
              <div className="sub" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                Open a public workspace right away, or request access to a private one.
              </div>
              <div className="ra-list">
                {disc.rows.map((w: any) => {
                  const pub = isPublic(w);
                  const isReq = requested[w.id];
                  return (
                    <div key={w.id} className="ra-row">
                      <span className="ws-emoji sm" style={wsTintStyle(w.id)}>{w.icon || wsEmoji(w.id)}</span>
                      <div className="ra-info">
                        <div className="nm">{w.name}</div>
                        <div className="sub">{w.memberCount ?? w.members ?? 0} members</div>
                      </div>
                      <span className={'ra-vis ' + (pub ? 'pub' : 'priv')}>
                        <img className="ic-12" src={ic(pub ? 'GlobeOutlined' : 'LockOutlined')} alt="" />{pub ? 'Public' : 'Private'}
                      </span>
                      {pub
                        ? <Btn variant="primary" size="sm" iconRight="ChevronRightOutlined" onClick={() => join(w.id)}>Open</Btn>
                        : isReq
                          ? <Btn size="sm" disabled className="ra-requested" icon="TickSmallOutlined">Requested</Btn>
                          : <Btn size="sm" icon="SendOutlined" onClick={() => request(w.id)}>Request access</Btn>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {showCreate && <CreateWorkspaceModal call={call} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); mine.refresh(); }} />}
      <DebugPanel log={log} />
    </div>
  );
}

/* ====================== 3 · Realm admin console ====================== */
function AdminScreen({ call, bar, me, realmRole, onBack, log }: any) {
  const [tab, setTab] = useState<'ws' | 'members' | 'requests'>('ws');
  const requests = useList(call, '/workspaces/join-requests');

  return (
    <div className="rbac">
      <AppBar realm={bar.realm?.name || 'Toddle'} sub="Realm" me={me} role={realmRole} onSignOut={bar.onSignOut}
        left={<Btn variant="ghost" icon="ChevronLeftOutlined" onClick={onBack}>Workspaces</Btn>} />
      <div className="ad-subbar">
        <div className="ad-title"><img className="ic-18 ic-muted" src={ic('DashboardOutlined')} alt="" />Admin console</div>
        <div className="ad-crumb">{bar.realm?.name || 'Toddle'} realm</div>
      </div>
      <div className="tabs">
        <span className={'tab' + (tab === 'ws' ? ' on' : '')} onClick={() => setTab('ws')}>
          <img className={'ic-14 ' + (tab === 'ws' ? '' : 'ic-muted')} src={ic('FolderOutlined')} alt="" />Workspaces
        </span>
        <span className={'tab' + (tab === 'members' ? ' on' : '')} onClick={() => setTab('members')}>
          <img className={'ic-14 ' + (tab === 'members' ? '' : 'ic-muted')} src={ic('MultipleUsersOutlined')} alt="" />Realm members
        </span>
        <span className={'tab' + (tab === 'requests' ? ' on' : '')} onClick={() => setTab('requests')}>
          <img className={'ic-14 ' + (tab === 'requests' ? '' : 'ic-muted')} src={ic('BellRingOutlined')} alt="" />Join requests
          {requests.rows.length > 0 && <span className="ct alert">{requests.rows.length}</span>}
        </span>
      </div>

      {tab === 'ws' && <AdminWorkspaces call={call} />}
      {tab === 'members' && <RealmMembers call={call} realmRole={realmRole} myId={me?.id} />}
      {tab === 'requests' && <RealmRequests call={call} list={requests} />}

      <DebugPanel log={log} />
    </div>
  );
}

function AdminWorkspaces({ call }: { call: any }) {
  const { rows, refresh } = useList(call, '/workspaces');
  const [create, setCreate] = useState(false);
  const [rename, setRename] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Workspaces</h1>
            <div className="sub">Workspaces in the realm. As a realm admin you have Admin access to all of them.</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="srch-box"><img className="ic-14 ic-muted" src={ic('SearchOutlined')} alt="" /><input placeholder="Search workspaces…" /></span>
            <Btn variant="primary" icon="AddOutlined" onClick={() => setCreate(true)}>New workspace</Btn>
          </div>
        </div>
        <div className="tbl ad-ws-tbl">
          <div className="thead"><div>Workspace</div><div>Members</div><div>Created</div><div style={{ textAlign: 'right' }}>Actions</div></div>
          {rows.map((w: any) => (
            <div key={w.id} className="trow">
              <div className="cell-main">
                <span className="ws-emoji sm" style={wsTintStyle(w.id)}>{w.icon || wsEmoji(w.id)}</span>
                <div><div className="nm">{w.name}</div><div className="sub">{(w.visibility || 'private').toLowerCase()}</div></div>
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>{w.memberCount ?? w.members ?? '—'}</div>
              <div style={{ color: 'var(--text-secondary)' }}>{w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—'}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="ibtn" title="Rename" onClick={() => setRename(w)}><img className="ic-14 ic-muted" src={ic('PencilOutlined')} alt="" /></button>
                <button className="ibtn" title="Delete" onClick={() => setDel(w)}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" /></button>
              </div>
            </div>
          ))}
          {!rows.length && <div className="trow"><div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>No workspaces yet — create one to get started.</div></div>}
        </div>
        <div className="ad-foot">{rows.length} workspaces</div>
      </div>

      {create && <CreateWorkspaceModal call={call} onClose={() => setCreate(false)} onDone={() => { setCreate(false); refresh(); }} />}
      {rename && <RenameWorkspaceModal call={call} ws={rename} onClose={() => setRename(null)} onDone={() => { setRename(null); refresh(); }} />}
      {del && <ConfirmDeleteWorkspace call={call} ws={del} onClose={() => setDel(null)} onDone={() => { setDel(null); refresh(); }} />}
    </div>
  );
}

function RealmMembers({ call, realmRole, myId }: { call: any; realmRole: RealmRole; myId?: string }) {
  const { rows, refresh } = useList(call, '/realm/users');
  const [add, setAdd] = useState(false);
  const isOwner = realmRole === 'OWNER';
  function changeRole(uid: string, r: string) { call(`PATCH /realm/users/${uid}`, () => api(`/realm/users/${uid}`, { method: 'PATCH', body: { role: r } })).then(refresh).catch(() => {}); }
  function remove(uid: string, who: string) { if (window.confirm(`Remove ${who} from the realm?`)) call(`DELETE /realm/users/${uid}`, () => api(`/realm/users/${uid}`, { method: 'DELETE' })).then(refresh).catch(() => {}); }
  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Realm members</h1>
            <div className="sub">{isOwner ? 'As Owner you can manage maintainers and members.' : 'As Maintainer you can manage members (not other maintainers).'}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="srch-box"><img className="ic-14 ic-muted" src={ic('SearchOutlined')} alt="" /><input placeholder="Search people…" /></span>
            <Btn variant="primary" icon="AddOutlined" onClick={() => setAdd(true)}>Add member</Btn>
          </div>
        </div>
        <div className="tbl ad-mem-tbl">
          <div className="thead"><div>Person</div><div>Realm role</div><div>Joined</div><div style={{ textAlign: 'right' }}>Actions</div></div>
          {rows.map((m: any) => {
            const uid = userId_(m);
            const role = asRealmRole(m.role);
            const isMe = uid === myId;
            const locked = role === 'OWNER';
            const maintainerLockedForMaintainer = role === 'MAINTAINER' && !isOwner;
            const editable = !locked && !maintainerLockedForMaintainer;
            return (
              <div key={uid} className="trow">
                <div className="cell-main">
                  <Avatar person={personOf(m)} size={32} />
                  <div><div className="nm">{name_(m) || email_(m)} {isMe && <span className="you-tag">You</span>}</div><div className="sub">{email_(m)}</div></div>
                </div>
                <div>
                  {editable
                    ? <RoleDropdown kind="realm" value={role} options={REALM_ROLE_OPTIONS} onChange={(v) => changeRole(uid, v)} />
                    : <span className="role-dd locked"><RealmChip role={role} /><img className="ic-14" src={ic('LockOutlined')} alt="" /></span>}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : (locked ? 'Owner · seeded' : '—')}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  {locked
                    ? <span className="lock-note"><img className="ic-14" src={ic('LockOutlined')} alt="" />Owner</span>
                    : <button className="ibtn" title="Remove member" disabled={!editable} style={!editable ? { opacity: .4 } : undefined} onClick={() => editable && remove(uid, email_(m))}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" /></button>}
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="trow"><div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>No members (need realm admin rights).</div></div>}
        </div>
      </div>
      {add && <AddRealmMemberModal call={call} onClose={() => setAdd(false)} onDone={() => { setAdd(false); refresh(); }} />}
    </div>
  );
}

function RealmRequests({ call, list }: { call: any; list: ReturnType<typeof useList> }) {
  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Join requests</h1>
            <div className="sub">People asking to join workspaces across the realm. Approve to add them with a role.</div>
          </div>
        </div>
        <RequestsTable rows={list.rows} refresh={list.refresh} call={call} wsOf={(r) => r.workspaceId ?? r.workspace?.id} showWorkspace realmWide />
        <div className="ad-foot">{list.rows.length} pending requests</div>
      </div>
    </div>
  );
}

/* shared requests table (realm-wide + workspace-scoped) */
function RequestsTable({ rows, refresh, call, wsOf, showWorkspace, realmWide }: { rows: any[]; refresh: () => void; call: any; wsOf: (r: any) => string; showWorkspace?: boolean; realmWide?: boolean }) {
  function approve(r: any, grant: string) { call('POST approve', () => api(`/workspaces/${wsOf(r)}/requests/${r.id}/approve`, { method: 'POST', body: { role: grant } })).then(refresh).catch(() => {}); }
  function reject(r: any) { call('POST reject', () => api(`/workspaces/${wsOf(r)}/requests/${r.id}/reject`, { method: 'POST' })).then(refresh).catch(() => {}); }
  return (
    <div className={'tbl ' + (realmWide ? 'ad-req-tbl' : 'ws-req-tbl')}>
      <div className="thead">
        <div>Person</div>{showWorkspace && <div>Workspace</div>}<div>Grant role</div><div>Requested</div><div style={{ textAlign: 'right' }}>Decision</div>
      </div>
      {rows.map((r: any, i: number) => <RequestRow key={r.id ?? i} r={r} wsOf={wsOf} showWorkspace={showWorkspace} onApprove={approve} onReject={reject} />)}
      {!rows.length && <div className="trow"><div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>No pending requests.</div></div>}
    </div>
  );
}
function RequestRow({ r, wsOf, showWorkspace, onApprove, onReject }: { r: any; wsOf: (r: any) => string; showWorkspace?: boolean; onApprove: (r: any, g: string) => void; onReject: (r: any) => void }) {
  const [grant, setGrant] = useState<WsRole>(asWsRole(r.requestedRole));
  const pending = (r.state ?? r.status ?? 'PENDING').toUpperCase() === 'PENDING';
  const wsId = wsOf(r);
  return (
    <div className="trow">
      <div className="cell-main">
        <Avatar person={personOf(r)} size={32} />
        <div><div className="nm">{name_(r) || email_(r) || userId_(r)}</div><div className="sub">{email_(r)}{r.note ? ' · ' + r.note : ''}</div></div>
      </div>
      {showWorkspace && <div><span className="ws-pill"><span className="ws-emoji sm" style={{ width: 24, height: 24, fontSize: 14, ...wsTintStyle(wsId) }}>{wsEmoji(wsId)}</span>{r.workspace?.name || wsId}</span></div>}
      <div><RoleDropdown kind="ws" value={grant} options={WS_ROLE_OPTIONS} onChange={(v) => setGrant(v as WsRole)} /></div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</div>
      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <Btn variant="primary" size="sm" icon="TickSmallOutlined" disabled={!pending} onClick={() => onApprove(r, grant)}>Approve</Btn>
        <Btn size="sm" disabled={!pending} onClick={() => onReject(r)}>Decline</Btn>
      </div>
    </div>
  );
}

/* ====================== 4 · Inside a workspace ====================== */
function WorkspaceScreen({ call, bar, wsId, me, realmRole, isRealmAdmin, openDocId, onOpenDoc, onCloseDoc, onLeave, onSwitch, onAdmin, log }: any) {
  const [ws, setWs] = useState<any>(null);
  const [myRole, setMyRole] = useState<WsRole>('READ');
  const [view, setView] = useState<'docs' | 'members' | 'requests'>('docs');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [denied, setDenied] = useState(false);
  const [folder, setFolder] = useState<{ id: string; name: string; icon?: string } | null>(null);

  useEffect(() => {
    setDenied(false);
    setFolder(null);
    call(`GET /workspaces/${wsId}`, () => api(`/workspaces/${wsId}`))
      .then((w: any) => { setWs(w); setMyRole(isRealmAdmin ? 'ADMIN' : asWsRole(w?.role)); })
      .catch((e: ApiError) => { if (e.status === 403 || e.status === 404) setDenied(true); });
  }, [call, wsId, isRealmAdmin]);

  const isWsAdmin = isRealmAdmin || myRole === 'ADMIN';
  const canCreateDoc = isWsAdmin || myRole === 'EDIT';

  // pick a folder → show its docs in the right panel (and leave any open doc)
  function selectFolder(f: { id: string; name: string; icon?: string } | null) {
    setFolder(f); setView('docs'); if (openDocId) onCloseDoc();
  }
  // create a doc or sheet (optionally inside a folder) and open it
  function createDoc(folderId?: string, type: 'DOC' | 'SHEET' = 'DOC') {
    const kind = type === 'SHEET' ? 'Sheet' : 'Document';
    const title = (window.prompt(`${kind} title`, 'Untitled') || '').trim() || 'Untitled';
    const body: any = { title, workspaceId: wsId };
    if (folderId) body.folderId = folderId;
    if (type === 'SHEET') body.type = 'SHEET';
    call('POST /documents', () => api('/documents', { method: 'POST', body }))
      .then((d: any) => { if (d?.id) onOpenDoc(d.id); }).catch(() => {});
  }

  if (denied) return <NoAccess403 me={me} realmRole={realmRole} onSignOut={bar.onSignOut} onBack={onLeave} />;

  const wsName = ws?.name || 'Workspace';
  return (
    <div className="rbac" onClick={() => switcherOpen && setSwitcherOpen(false)}>
      {/* top bar */}
      <div className="ws-topbar">
        <div className="ws-switch-wrap" onClick={(e) => e.stopPropagation()}>
          <button className={'ws-switch' + (switcherOpen ? ' open' : '')} onClick={() => setSwitcherOpen((s) => !s)}>
            <span className="ws-emoji sm" style={wsTintStyle(wsId)}>{ws?.icon || wsEmoji(wsId)}</span>
            <span className="nm">{wsName}</span>
            <img className="ic-14 ic-muted" src={ic('ChevronDownOutlined')} alt="" />
          </button>
          {switcherOpen && <Switcher call={call} current={wsId} isAdmin={isRealmAdmin} onPick={onSwitch} onLauncher={onLeave} />}
        </div>
        <div className="ws-tb-right">
          {isRealmAdmin ? <WSChip overlay /> : <WSChip role={myRole} />}
          {isRealmAdmin && <Btn size="sm" variant="ghost" icon="DashboardOutlined" onClick={onAdmin}>Admin</Btn>}
          <button className="ibtn"><img className="ic-18 ic-muted" src={ic('SearchOutlined')} alt="" /></button>
          <span className="ws-acct" onClick={bar.onSignOut} title="Sign out"><Avatar person={{ name: me?.name, email: me?.email }} size={30} /><img className="ic-14 ic-muted" src={ic('ChevronDownOutlined')} alt="" /></span>
        </div>
      </div>

      <div className="ws-body">
        <WsNav call={call} wsId={wsId} wsName={wsName} isAdmin={isWsAdmin}
          view={openDocId ? '' : view}
          setView={(v: 'docs' | 'members' | 'requests') => { setView(v); if (openDocId) onCloseDoc(); }}
          selectedFolderId={openDocId ? null : folder?.id ?? null} onSelectFolder={selectFolder}
          canCreateDoc={canCreateDoc} onCreateDoc={createDoc}
          onLauncher={onLeave} isRealmAdmin={isRealmAdmin} />

        {openDocId
          ? <DocReader docId={openDocId} me={me} wsName={wsName} onClose={onCloseDoc} />
          : view === 'members'
            ? <MembersPanel call={call} wsId={wsId} wsName={wsName} myId={me?.id} canManage={isWsAdmin} canSeeRealm={isRealmAdmin} />
            : view === 'requests'
              ? <RequestsPanel call={call} wsId={wsId} wsName={wsName} />
              : <DocsList call={call} wsId={wsId} wsName={wsName} folder={folder} canCreate={canCreateDoc} onOpenDoc={onOpenDoc} onCreateDoc={createDoc} />}
      </div>
      <DebugPanel log={log} />
    </div>
  );
}

function Switcher({ call, current, isAdmin, onPick, onLauncher }: any) {
  const { rows } = useList(call, '/workspaces');
  return (
    <div className="ws-switch-menu">
      <div className="sm-label">Switch workspace</div>
      {rows.map((w: any) => (
        <div key={w.id} className={'sm-row' + (w.id === current ? ' on' : '')} onClick={() => w.id !== current && onPick(w.id)}>
          <span className="ws-emoji sm" style={wsTintStyle(w.id)}>{w.icon || wsEmoji(w.id)}</span>
          <span className="nm">{w.name}</span>
          {w.id === current && <img className="ic-14" src={ic('TickSmallOutlined')} alt="" style={{ marginLeft: 'auto', filter: 'invert(38%) sepia(83%) saturate(2046%) hue-rotate(327deg) brightness(94%)' }} />}
        </div>
      ))}
      <div className="sm-div" />
      <div className="sm-row foot" onClick={onLauncher}>
        <img className="ic-14 ic-muted" src={ic('ChevronLeftOutlined')} alt="" />{isAdmin ? 'Back to all workspaces' : 'Workspace launcher'}
      </div>
    </div>
  );
}

/* left nav — folder tree built from real folders, docs loaded on select */
function WsNav({ call, wsId, isAdmin, view, setView, selectedFolderId, onSelectFolder, canCreateDoc, onCreateDoc, onLauncher, isRealmAdmin }: any) {
  const [folders, setFolders] = useState<any[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menuId, setMenuId] = useState<string | null>(null);
  const [reqCount, setReqCount] = useState(0);
  const [memCount, setMemCount] = useState(0);
  const [addFolder, setAddFolder] = useState<string | null | false>(false); // false=closed, null=root, id=parent

  const loadFolders = useCallback(() => {
    call('GET /folders', () => api(`/folders?workspaceId=${wsId}`)).then((d: any) => setFolders(asRows(d))).catch(() => {});
  }, [call, wsId]);
  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => {
    if (!isAdmin) return;
    call('GET requests', () => api(`/workspaces/${wsId}/requests`)).then((d: any) => setReqCount(asRows(d).length)).catch(() => {});
    call('GET users', () => api(`/workspaces/${wsId}/users`)).then((d: any) => setMemCount(asRows(d).length)).catch(() => {});
  }, [call, wsId, isAdmin]);

  const roots = folders.filter((f) => !f.parentId);
  const childrenOf = (id: string) => folders.filter((f) => f.parentId === id);

  function renderFolder(f: any, depth: number): ReactNode {
    const isOpen = open[f.id];
    const kids = childrenOf(f.id);
    const active = f.id === selectedFolderId;
    return (
      <div key={f.id}>
        <div className={'tree-row folder' + (active ? ' active' : '') + (menuId === f.id ? ' menu-open' : '')} style={{ paddingLeft: 8 + depth * 15 }}
          onClick={() => { onSelectFolder({ id: f.id, name: f.name, icon: f.icon }); if (kids.length) setOpen((o) => ({ ...o, [f.id]: !o[f.id] })); }}>
          <img className={'ic-14 ic-muted chev' + (isOpen ? ' open' : '')} src={ic('ChevronRightOutlined')} alt=""
            style={kids.length ? undefined : { opacity: .25 }}
            onClick={(e) => { e.stopPropagation(); if (kids.length) setOpen((o) => ({ ...o, [f.id]: !o[f.id] })); }} />
          <span className="tw-emoji">{f.icon || '📁'}</span>
          <span className="tw-lbl">{f.name}</span>
          {isAdmin && (
            <button className="tw-more" onClick={(e) => { e.stopPropagation(); setMenuId(menuId === f.id ? null : f.id); }}>
              <img className="ic-14 ic-muted" src={ic('DotsHorizontalOutlined')} alt="" />
            </button>
          )}
          {menuId === f.id && (
            <FolderMenu call={call} folder={f} canCreateDoc={canCreateDoc}
              onClose={() => setMenuId(null)} onChanged={loadFolders}
              onAddDoc={() => { onSelectFolder({ id: f.id, name: f.name, icon: f.icon }); onCreateDoc(f.id); setMenuId(null); }}
              onAddSheet={() => { onSelectFolder({ id: f.id, name: f.name, icon: f.icon }); onCreateDoc(f.id, 'SHEET'); setMenuId(null); }}
              onAddFolder={() => { setAddFolder(f.id); setMenuId(null); }}
              onDeleted={() => { if (selectedFolderId === f.id) onSelectFolder(null); }} />
          )}
        </div>
        {isOpen && kids.map((c) => renderFolder(c, depth + 1))}
      </div>
    );
  }

  return (
    <aside className="ws-nav">
      <div className="ws-nav-search">
        <img className="ic-14 ic-muted" src={ic('SearchOutlined')} alt="" />
        <input placeholder="Search this workspace…" />
      </div>
      <div className="ws-nav-quick">
        <div className={'qk-row' + (view === 'docs' && !selectedFolderId ? ' active' : '')} onClick={() => onSelectFolder(null)}>
          <img className={'ic ' + (view === 'docs' && !selectedFolderId ? '' : 'ic-muted')} src={ic('HomeOutlined')} alt="" />All documents
        </div>
        <div className="qk-row"><img className="ic ic-muted" src={ic('StarOutlined')} alt="" />Starred</div>
      </div>

      <div className="ws-nav-grp">
        Folders
        {isAdmin && <button className="grp-add" title="New folder" onClick={() => setAddFolder(null)}><img className="ic-14 ic-muted" src={ic('AddOutlined')} alt="" /></button>}
      </div>
      <div className="ws-tree" onClick={(e) => { if (menuId && e.target === e.currentTarget) setMenuId(null); }}>
        {roots.map((f) => renderFolder(f, 0))}
        {!roots.length && <div className="tree-row" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No folders yet</div>}
      </div>

      <div className="ws-nav-foot">
        {isAdmin && (
          <div className={'qk-row' + (view === 'requests' ? ' active' : '')} onClick={() => setView('requests')}>
            <img className={'ic ' + (view === 'requests' ? '' : 'ic-muted')} src={ic('BellRingOutlined')} alt="" />Requests
            {reqCount > 0 && <span className="qk-ct alert">{reqCount}</span>}
          </div>
        )}
        {isAdmin && (
          <div className={'qk-row' + (view === 'members' ? ' active' : '')} onClick={() => setView('members')}>
            <img className={'ic ' + (view === 'members' ? '' : 'ic-muted')} src={ic('MultipleUsersOutlined')} alt="" />Members
            {memCount > 0 && <span className="qk-ct">{memCount}</span>}
          </div>
        )}
        <div className="qk-row" style={{ color: 'var(--text-secondary)' }} onClick={onLauncher}>
          <img className="ic ic-muted" src={ic('ChevronLeftOutlined')} alt="" />{isRealmAdmin ? 'All workspaces' : 'Launcher'}
        </div>
      </div>

      {addFolder !== false && <CreateFolderModal call={call} wsId={wsId} parentId={addFolder || undefined} onClose={() => setAddFolder(false)} onDone={() => { setAddFolder(false); loadFolders(); }} />}
    </aside>
  );
}

function FolderMenu({ call, folder, canCreateDoc, onClose, onChanged, onAddDoc, onAddSheet, onAddFolder, onDeleted }: any) {
  function rename() {
    const n = window.prompt('New folder name', folder.name);
    if (n && n !== folder.name) call(`PATCH /folders/${folder.id}`, () => api(`/folders/${folder.id}`, { method: 'PATCH', body: { name: n } })).then(onChanged).catch(() => {});
    onClose();
  }
  function del() {
    if (window.confirm(`Delete folder "${folder.name}"? Documents inside are not deleted.`)) call(`DELETE /folders/${folder.id}`, () => api(`/folders/${folder.id}`, { method: 'DELETE' })).then(() => { onDeleted?.(); onChanged(); }).catch(() => {});
    onClose();
  }
  return (
    <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
      {canCreateDoc && <div className="fm-row" onClick={() => { onAddDoc(); }}><img className="ic-14 ic-muted" src={ic('AddOutlined')} alt="" />Add doc</div>}
      {canCreateDoc && <div className="fm-row" onClick={() => { onAddSheet(); }}><img className="ic-14 ic-muted" src={ic('GridOutlined')} alt="" />Add sheet</div>}
      <div className="fm-row" onClick={() => { onAddFolder(); }}><img className="ic-14 ic-muted" src={ic('FolderOutlined')} alt="" />Add subfolder</div>
      <div className="fm-row" onClick={rename}><img className="ic-14 ic-muted" src={ic('PencilOutlined')} alt="" />Rename</div>
      <div className="fm-div" />
      <div className="fm-row danger" onClick={del}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" />Delete</div>
    </div>
  );
}

/* right panel — documents list (whole workspace, or one folder) */
function DocsList({ call, wsId, wsName, folder, canCreate, onOpenDoc, onCreateDoc }: any) {
  const [docs, setDocs] = useState<any[]>([]);
  // always send workspaceId — don't depend on the token's activeWorkspaceId,
  // which a token refresh clears (refresh re-issues a non-workspace-scoped token).
  const q = folder ? `?workspaceId=${wsId}&folderId=${folder.id}` : `?workspaceId=${wsId}`;
  const load = useCallback(() => {
    call(`GET /documents${q}`, () => api(`/documents${q}`)).then((d: any) => setDocs(asRows(d))).catch(() => {});
  }, [call, q]);
  useEffect(() => { load(); }, [load]);

  function delDoc(d: any, e: React.MouseEvent) { e.stopPropagation(); if (window.confirm(`Delete "${d.title || 'Untitled'}"?`)) call(`DELETE /documents/${d.id}`, () => api(`/documents/${d.id}`, { method: 'DELETE' })).then(load).catch(() => {}); }

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span>{wsName}</span><span className="sep">/</span>
          <span className="cur">{folder ? `${folder.icon || '📁'} ${folder.name}` : '📄 All documents'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>{canCreate && <>
          <Btn size="sm" variant="ghost" icon="GridOutlined" onClick={() => onCreateDoc(folder?.id, 'SHEET')}>New sheet</Btn>
          <Btn size="sm" icon="AddOutlined" onClick={() => onCreateDoc(folder?.id)}>New doc</Btn>
        </>}</div>
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={folder ? { background: 'var(--surface-tertiary-enabled)' } : wsTintStyle(wsId)}>{folder ? (folder.icon || '📁') : wsEmoji(wsId)}</span>
          <div>
            <h1>{folder ? folder.name : wsName}</h1>
            <div className="sub">{docs.length} {docs.length === 1 ? 'document' : 'documents'}{folder ? ` · in ${wsName}` : ''}</div>
          </div>
        </div>
        <div className="tbl ws-docs-tbl">
          <div className="thead"><div>Name</div><div>Owner</div><div>Edited</div><div>Sharing</div></div>
          {docs.map((d: any) => (
            <div key={d.id} className="trow" onClick={() => onOpenDoc(d.id)}>
              <div className="cell-main">
                <span className="tw-emoji big">{d.icon || (d.type === 'SHEET' ? '📊' : '📄')}</span>
                <div><div className="nm">{d.title || 'Untitled'}</div>{d.summary && <div className="sub">{d.summary}</div>}</div>
              </div>
              <div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar person={{ name: name_(d.owner) || d.ownerName, email: email_(d.owner) || d.ownerEmail }} size={22} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{(name_(d.owner) || d.ownerName || '').split(' ')[0] || '—'}</span>
              </div></div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : '—'}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="lock-note"><img className="ic-14" src={ic((d.visibility || '').toUpperCase() === 'PUBLIC' ? 'GlobeOutlined' : 'LockOutlined')} alt="" />{(d.visibility || 'workspace').toLowerCase()}</span>
                {canCreate && <button className="ibtn" title="Delete" onClick={(e) => delDoc(d, e)}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" /></button>}
              </div>
            </div>
          ))}
          {!docs.length && (
            <div className="trow"><div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)' }}>
              <span>{folder ? `No documents in “${folder.name}” yet.` : 'No documents here yet.'}</span>
              {canCreate && <Btn size="sm" icon="AddOutlined" onClick={() => onCreateDoc(folder?.id)}>New doc</Btn>}
            </div></div>
          )}
        </div>
      </div>
    </main>
  );
}

/* right panel — doc reader chrome wrapping the real collaborative surface
   (rich-text editor for DOC, data grid for SHEET) */
function DocReader({ docId, me, wsName, onClose }: { docId: string; me: Me; wsName: string; onClose: () => void }) {
  // Fetch the document to pick the right surface; works on direct URL load too.
  const [doc, setDoc] = useState<{ type?: string; title?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    api(`/documents/${docId}`).then((d: any) => { if (!cancelled) setDoc(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [docId]);

  const isSheet = doc?.type === 'SHEET';
  const meProps = me ? { id: me.id, email: me.email, name: me.name, color: me.color } : null;
  return (
    <main className="ws-main">
      <div className="ws-docbar">
        <div className="ws-doc-title">
          <button className="ibtn sm" onClick={onClose} title="Back"><img className="ic-14 ic-muted" src={ic('ChevronLeftOutlined')} alt="" /></button>
          <span className="ws-doc-crumb">{wsName} /</span>
          <span className="ws-doc-nm" id="doc-reader-title">{doc?.title || (isSheet ? 'Sheet' : 'Document')}</span>
        </div>
        <div className="ws-doc-people">
          <Btn variant="primary" size="sm" icon="ShareOutlined">Share</Btn>
        </div>
      </div>
      <div className="ws-scroll editor">
        <div className="editor-host">
          {meProps && doc && (
            <Suspense fallback={<div style={{ padding: 24 }} className="muted">Loading…</div>}>
              {isSheet
                ? <SheetView docId={docId} me={meProps} onBack={onClose} />
                : <DocView docId={docId} me={meProps} onBack={onClose} />}
            </Suspense>
          )}
        </div>
      </div>
    </main>
  );
}

/* right panel — members (admin) */
function MembersPanel({ call, wsId, wsName, myId, canManage, canSeeRealm }: any) {
  const { rows, refresh } = useList(call, `/workspaces/${wsId}/users`, [wsId]);
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<any>(null);
  // realm OWNER/MAINTAINER act as Admin in EVERY workspace (overlay), regardless
  // of their stored workspace role — fetch realm roles so the table can show that.
  const [realmAdmins, setRealmAdmins] = useState<Record<string, RealmRole>>({});
  useEffect(() => {
    if (!canSeeRealm) return;
    call('GET /realm/users', () => api('/realm/users')).then((d: any) => {
      const map: Record<string, RealmRole> = {};
      for (const u of asRows(d)) { const r = asRealmRole(u.role); if (r !== 'MEMBER') map[userId_(u)] = r; }
      setRealmAdmins(map);
    }).catch(() => {});
  }, [call, canSeeRealm]);

  const adminCount = rows.filter((m: any) => asWsRole(m.role) === 'ADMIN').length;
  function changeRole(uid: string, r: string) { call(`PATCH /workspaces/${wsId}/users/${uid}`, () => api(`/workspaces/${wsId}/users/${uid}`, { method: 'PATCH', body: { role: r } })).then(refresh).catch(() => {}); }
  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs"><span>{wsName}</span><span className="sep">/</span><span className="cur">👥 Members</span></div>
        {canManage && <Btn variant="primary" size="sm" icon="AddOutlined" onClick={() => setAdd(true)}>Add member</Btn>}
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>👥</span>
          <div><h1>Members</h1><div className="sub">{rows.length} {rows.length === 1 ? 'person' : 'people'} in {wsName}</div></div>
        </div>
        <div className="tbl ws-mem-tbl">
          <div className="thead"><div>Person</div><div>Workspace role</div><div style={{ textAlign: 'right' }}>Actions</div></div>
          {rows.map((m: any) => {
            const uid = userId_(m);
            const role = asWsRole(m.role);
            const isMe = uid === myId;
            const realmRole = realmAdmins[uid]; // OWNER / MAINTAINER → acts as Admin via realm
            const viaRealm = !!realmRole;
            const soleAdmin = role === 'ADMIN' && adminCount <= 1;
            return (
              <div key={uid} className="trow">
                <div className="cell-main">
                  <Avatar person={personOf(m)} size={32} />
                  <div>
                    <div className="nm">{name_(m) || email_(m)} {isMe && <span className="you-tag">You</span>}{viaRealm && !isMe && <span className="you-tag">Realm {REALM_ROLE[realmRole].label.toLowerCase()}</span>}</div>
                    <div className="sub">{email_(m)}</div>
                  </div>
                </div>
                <div>
                  {viaRealm
                    ? <span className="role-dd locked" title="Realm admins act as Admin in every workspace"><WSChip overlay /></span>
                    : <RoleDropdown kind="ws" value={role} options={WS_ROLE_OPTIONS} onChange={(v) => changeRole(uid, v)} locked={!canManage} />}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {viaRealm
                    ? <span className="lock-note"><img className="ic-14" src={ic('LockOutlined')} alt="" />Via realm</span>
                    : canManage && (soleAdmin
                      ? <span className="blocked-wrap"><button className="ibtn" disabled style={{ opacity: .4 }}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" /></button><span className="blocked-tip"><img className="ic-12 ic-white" src={ic('InformationOutlined')} alt="" />Can’t remove the last admin</span></span>
                      : <button className="ibtn" title="Remove from workspace" onClick={() => setRemove(m)}><img className="ic-14 ic-red" src={ic('DeleteOutlined')} alt="" /></button>)}
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="trow"><div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>No members yet.</div></div>}
        </div>
      </div>
      {add && <AddWsMemberModal call={call} wsId={wsId} wsName={wsName} onClose={() => setAdd(false)} onDone={() => { setAdd(false); refresh(); }} />}
      {remove && <ConfirmRemoveMember call={call} wsId={wsId} wsName={wsName} member={remove} onClose={() => setRemove(null)} onDone={() => { setRemove(null); refresh(); }} />}
    </main>
  );
}

/* right panel — join requests (admin) */
function RequestsPanel({ call, wsId, wsName }: any) {
  const { rows, refresh } = useList(call, `/workspaces/${wsId}/requests`, [wsId]);
  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs"><span>{wsName}</span><span className="sep">/</span><span className="cur">📥 Requests</span></div>
        <span className="lock-note"><img className="ic-14" src={ic('LockOutlined')} alt="" />Only admins see this</span>
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>📥</span>
          <div><h1>Join requests</h1><div className="sub">{rows.length} {rows.length === 1 ? 'person wants' : 'people want'} to join {wsName}</div></div>
        </div>
        <RequestsTable rows={rows} refresh={refresh} call={call} wsOf={() => wsId} />
      </div>
    </main>
  );
}

/* ====================== 5 · Modals ====================== */
const EMOJIS = ['🚀', '🛠️', '🎨', '📣', '🌱', '📈', '🔬', '📚', '💡', '🧭', '🗂️', '⚡'];

function CreateWorkspaceModal({ call, onClose, onDone }: any) {
  const [name, setName] = useState('');
  const [vis, setVis] = useState('PRIVATE');
  const [emoji, setEmoji] = useState('🚀');
  function create() { call('POST /workspaces', () => api('/workspaces', { method: 'POST', body: { name, visibility: vis, icon: emoji } })).then(onDone).catch(() => {}); }
  return (
    <Modal onClose={onClose}>
      <ModalHead tone="brand" icon="AddOutlined" title="Create a workspace" sub="You’ll become its Admin and can add people next." onClose={onClose} />
      <div className="m-body">
        <Field label="Workspace name">
          <span className="inp inp-emoji"><button className="emoji-btn" type="button">{emoji}</button><input autoFocus placeholder="Customer Research" value={name} onChange={(e) => setName(e.target.value)} /></span>
        </Field>
        <Field label="Icon">
          <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} type="button" className={'emoji-cell' + (e === emoji ? ' on' : '')} onClick={() => setEmoji(e)}>{e}</button>)}</div>
        </Field>
        <Field label="Visibility">
          <div className="role-radios cols">
            <label className={'role-opt' + (vis === 'PRIVATE' ? ' on' : '')} onClick={() => setVis('PRIVATE')}><span className="rd" /><div><div className="ttl">Private</div><div className="ds">Invite-only; appears as request-to-join</div></div></label>
            <label className={'role-opt' + (vis === 'PUBLIC' ? ' on' : '')} onClick={() => setVis('PUBLIC')}><span className="rd" /><div><div className="ttl">Public</div><div className="ds">Anyone in the realm can open it</div></div></label>
          </div>
        </Field>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="AddOutlined" disabled={!name} onClick={create}>Create workspace</Btn></div>
    </Modal>
  );
}

function RenameWorkspaceModal({ call, ws, onClose, onDone }: any) {
  const [name, setName] = useState(ws.name || '');
  function save() { call(`PATCH /workspaces/${ws.id}`, () => api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { name } })).then(onDone).catch(() => {}); }
  return (
    <Modal onClose={onClose}>
      <ModalHead icon="PencilOutlined" title="Rename workspace" sub="This changes the name everywhere for all members." onClose={onClose} />
      <div className="m-body">
        <Field label="Workspace name">
          <span className="inp inp-emoji"><button className="emoji-btn" type="button">{ws.icon || wsEmoji(ws.id)}</button><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></span>
        </Field>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!name || name === ws.name} onClick={save}>Save changes</Btn></div>
    </Modal>
  );
}

function ConfirmDeleteWorkspace({ call, ws, onClose, onDone }: any) {
  const [confirm, setConfirm] = useState('');
  function del() { call(`DELETE /workspaces/${ws.id}`, () => api(`/workspaces/${ws.id}`, { method: 'DELETE' })).then(onDone).catch(() => {}); }
  return (
    <Modal onClose={onClose}>
      <ModalHead tone="danger" icon="DeleteOutlined" title={`Delete “${ws.name}”?`} sub="This permanently deletes the workspace and the docs inside it. This can’t be undone." onClose={onClose} />
      <div className="m-body">
        <div className="danger-box"><img className="ic-14" style={{ filter: 'invert(38%) sepia(83%) saturate(2046%) hue-rotate(327deg) brightness(94%)' }} src={ic('WarningTriangleOutlined')} alt="" /><span>Members will lose access immediately.</span></div>
        <Field label="Type the workspace name to confirm"><Input placeholder={ws.name} value={confirm} onChange={setConfirm} /></Field>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" icon="DeleteOutlined" disabled={confirm !== ws.name} onClick={del}>Delete workspace</Btn></div>
    </Modal>
  );
}

function AddRealmMemberModal({ call, onClose, onDone }: any) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RealmRole>('MEMBER');
  const [err, setErr] = useState<string | null>(null);
  function add() {
    setErr(null);
    call('POST /realm/users', () => api('/realm/users', { method: 'POST', body: { email, role } }))
      .then(onDone)
      .catch((e: ApiError) => setErr(e.status === 404 ? 'No user with that email — they must register first.' : 'Could not add this member.'));
  }
  return (
    <Modal onClose={onClose}>
      <ModalHead icon="MultipleUsersOutlined" title="Add realm member" sub="Add an existing Toddle account to the realm by email." onClose={onClose} />
      <div className="m-body">
        <Field label="Email address"><Input icon="EmailOutlined" placeholder="person@toddle.com" value={email} onChange={setEmail} err={!!err} autoFocus /></Field>
        {err && <div className="err-text"><img className="ic-14" src={ic('WarningTriangleOutlined')} alt="" />{err}</div>}
        <Field label="Realm role">
          <div className="role-radios">
            <label className={'role-opt' + (role === 'MAINTAINER' ? ' on' : '')} onClick={() => setRole('MAINTAINER')}><span className="rd" /><div><div className="ttl">Maintainer</div><div className="ds">Manage workspaces & realm members</div></div></label>
            <label className={'role-opt' + (role === 'MEMBER' ? ' on' : '')} onClick={() => setRole('MEMBER')}><span className="rd" /><div><div className="ttl">Member</div><div className="ds">Access only what their workspace roles allow</div></div></label>
          </div>
        </Field>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="AddOutlined" disabled={!email} onClick={add}>Add to realm</Btn></div>
    </Modal>
  );
}

function AddWsMemberModal({ call, wsId, wsName, onClose, onDone }: any) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WsRole>('EDIT');
  const [err, setErr] = useState<string | null>(null);
  function add() {
    setErr(null);
    call(`POST /workspaces/${wsId}/users`, () => api(`/workspaces/${wsId}/users`, { method: 'POST', body: { email, role } }))
      .then(onDone)
      .catch((e: ApiError) => setErr(e.status === 404 ? 'No user with that email — they must register first.' : 'Could not add this member.'));
  }
  return (
    <Modal onClose={onClose}>
      <ModalHead icon="AddOutlined" title={`Add to ${wsName}`} sub="Give someone access to this workspace by email." onClose={onClose} />
      <div className="m-body">
        <Field label="Email address"><Input icon="EmailOutlined" placeholder="person@toddle.com" value={email} onChange={setEmail} err={!!err} autoFocus /></Field>
        {err && <div className="err-text"><img className="ic-14" src={ic('WarningTriangleOutlined')} alt="" />{err}</div>}
        <Field label="Workspace role">
          <div className="role-radios cols">
            {WS_ROLE_OPTIONS.map((r) => (
              <label key={r} className={'role-opt' + (r === role ? ' on' : '')} onClick={() => setRole(r)}>
                <span className="rd" /><WSChip role={r} /><span className="ds" style={{ marginLeft: 2 }}>{WS_ROLE[r].ds}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="AddOutlined" disabled={!email} onClick={add}>Add to workspace</Btn></div>
    </Modal>
  );
}

function ConfirmRemoveMember({ call, wsId, wsName, member, onClose, onDone }: any) {
  const uid = userId_(member);
  function remove() { call(`DELETE /workspaces/${wsId}/users/${uid}`, () => api(`/workspaces/${wsId}/users/${uid}`, { method: 'DELETE' })).then(onDone).catch(() => {}); }
  return (
    <Modal onClose={onClose}>
      <ModalHead tone="danger" icon="DeleteOutlined" title={`Remove ${name_(member) || email_(member)}?`} sub={`They’ll lose access to ${wsName} and everything shared inside it.`} onClose={onClose} />
      <div className="m-body">
        <div className="found">
          <Avatar person={personOf(member)} size={34} />
          <div style={{ flex: 1 }}><div className="nm">{name_(member) || email_(member)}</div><div className="sub">{email_(member)}</div></div>
          <WSChip role={asWsRole(member.role)} />
        </div>
        <div className="m-note"><img className="ic-14 ic-muted" src={ic('InformationOutlined')} alt="" />They keep their realm account and any other workspaces they’re in.</div>
      </div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={remove}>Remove from workspace</Btn></div>
    </Modal>
  );
}

function CreateFolderModal({ call, wsId, parentId, onClose, onDone }: any) {
  const [name, setName] = useState('');
  function create() {
    const body: any = { name, workspaceId: wsId };
    if (parentId) body.parentId = parentId;
    call('POST /folders', () => api('/folders', { method: 'POST', body })).then(onDone).catch(() => {});
  }
  return (
    <Modal onClose={onClose}>
      <ModalHead icon="FolderOutlined" title={parentId ? 'New subfolder' : 'New folder'} sub="Organize documents into folders." onClose={onClose} />
      <div className="m-body"><Field label="Folder name"><Input placeholder="Specs" value={name} onChange={setName} autoFocus /></Field></div>
      <div className="m-foot"><span className="gap" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="AddOutlined" disabled={!name} onClick={create}>Create folder</Btn></div>
    </Modal>
  );
}

/* ====================== 6 · Permission states ====================== */
function NoAccess403({ me, realmRole, onSignOut, onBack }: any) {
  return (
    <div className="rbac">
      <AppBar realm="Toddle" sub="Realm" me={me} role={realmRole} onSignOut={onSignOut} />
      <div className="page" style={{ display: 'flex', alignItems: 'center' }}>
        <div className="page-wrap">
          <div className="empty">
            <span className="glyph" style={{ background: 'var(--surface-semantic-error)' }}>
              <img className="ic-24" style={{ filter: 'invert(38%) sepia(83%) saturate(2046%) hue-rotate(327deg) brightness(94%)', width: 40, height: 40 }} src={ic('LockOutlined')} alt="" />
            </span>
            <h2>You don’t have access to this</h2>
            <p>This workspace is private, or your role doesn’t include it. If you think this is a mistake, ask a realm admin to add you.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <Btn variant="primary" icon="ChevronLeftOutlined" onClick={onBack}>Back to workspaces</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* collapsible debug panel — last backend call's response */
function DebugPanel({ log }: { log: Log }) {
  const [open, setOpen] = useState(false);
  if (!log) return null;
  return (
    <div style={{ position: 'fixed', left: 14, bottom: 14, zIndex: 80 }}>
      {open && (
        <div style={{ marginBottom: 6, background: '#0f1115', color: '#d6dae0', borderRadius: 8, padding: '8px 12px', maxHeight: 300, overflow: 'auto', width: 'min(540px, 80vw)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}>
          <div style={{ color: log.ok ? '#5dd28a' : '#f08a8a', marginBottom: 4 }}>{log.ok ? '✓' : '✗'} {log.label}{log.status ? ` · ${log.status}` : ''}</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log.data, null, 2)}</pre>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} style={{ fontSize: 12, opacity: 0.9, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
        {log.ok ? '🟢' : '🔴'} API log {open ? '▾' : '▸'}
      </button>
    </div>
  );
}
