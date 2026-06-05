import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, asRows, getToken, setToken, type ApiError } from './api';
import { DocView } from './DocView';

const WS_ROLES = ['READ', 'COMMENT', 'EDIT', 'ADMIN'];
const REALM_ROLES = ['MEMBER', 'MAINTAINER']; // assignable (OWNER is seeded)

type Me = { id: string; email: string; name?: string; activeWorkspaceId?: string | null } | null;
type Log = { ok: boolean; label: string; status?: number; data: any } | null;

/* Mirrors the design flow:
   1 Auth (login / register → awaiting access)
   2 Workspace launcher (my workspaces)
   3 Request access (discover → join / request)
   4 Realm admin console (Workspaces / Members / Join requests)
   5 Inside a workspace (Members / Requests / switcher / leave)        */

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
    call('GET /auth/me', () => api('/auth/me')).then((d) => setMe(d?.user ?? d)).catch(() => {});
    call('GET /realm', () => api('/realm')).then(setRealm).catch(() => {});
  }, [call]);

  useEffect(() => { loadIdentity(); }, [token, loadIdentity]);

  // every state lives in the URL → reload restores the same page
  useEffect(() => {
    if (token && (loc.pathname === '/' || loc.pathname === '')) navigate('/workspaces', { replace: true });
  }, [token, loc.pathname, navigate]);

  function setSession(t: string | null) { setToken(t); setTok(t); }
  function logout() { setSession(null); setMe(null); setRealm(null); setAwaiting(false); navigate('/workspaces'); }
  function enterWs(id: string, t: string) { setSession(t); navigate(`/ws/${encodeURIComponent(id)}`); }
  function leaveWs() {
    call('POST /auth/workspace/leave', () => api('/auth/workspace/leave', { method: 'POST' }))
      .then((d) => { setSession(d.accessToken); navigate('/workspaces'); })
      .catch(() => navigate('/workspaces'));
  }

  // 1 · Auth — fresh sign-in always lands on the chooser
  if (!token)
    return <Auth call={call} onAuthed={(t, registered) => { setSession(t); setAwaiting(registered); navigate('/workspaces'); }} />;
  // 1b · awaiting access (just registered)
  if (awaiting)
    return <Awaiting email={me?.email} onContinue={() => setAwaiting(false)} onSignOut={logout} />;

  const isAdmin = realm?.role === 'OWNER' || realm?.role === 'MAINTAINER';
  const bar = { realm, me, onSignOut: logout };

  // view derived from the URL
  const wsMatch = loc.pathname.match(/^\/ws\/([^/]+)(?:\/doc\/([^/]+))?/);
  const activeWs = wsMatch ? decodeURIComponent(wsMatch[1]) : null;
  const openDocId = wsMatch && wsMatch[2] ? decodeURIComponent(wsMatch[2]) : null;

  // 3 · Realm admin console (full screen)
  if (loc.pathname === '/admin' && isAdmin)
    return <AdminScreen call={call} bar={bar} onBack={() => navigate('/workspaces')} log={log} />;
  // 4 · Inside the chosen workspace
  if (activeWs)
    return (
      <WorkspaceScreen
        call={call} bar={bar} wsId={activeWs} me={me} isAdmin={isAdmin}
        openDocId={openDocId}
        onOpenDoc={(d: string) => navigate(`/ws/${encodeURIComponent(activeWs)}/doc/${encodeURIComponent(d)}`)}
        onCloseDoc={() => navigate(`/ws/${encodeURIComponent(activeWs)}`)}
        onSwitch={leaveWs} onAdmin={() => navigate('/admin')} log={log}
      />
    );
  // 2 · Workspace chooser — shown on EVERY sign-in; user must pick a workspace
  return <Chooser call={call} bar={bar} isAdmin={isAdmin} onEnter={enterWs} onAdmin={() => navigate('/admin')} log={log} />;
}

/* ===================== top bar + full-page shells ===================== */
function TopBar({ realm, me, left, right, onSignOut }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--line)', background: '#fff' }}>
      <div style={{ fontWeight: 700, letterSpacing: '-.01em' }}>Toddle Compose</div>
      <span className="muted" style={{ fontSize: 12 }}>{realm?.name ?? 'Realm'}</span>
      {left}
      <div style={{ flex: 1 }} />
      {right}
      <span className="muted" style={{ fontSize: 12 }}>{me?.email}</span>
      {realm?.role && <span className="tag">{realm.role}</span>}
      <button onClick={onSignOut}>Sign out</button>
    </div>
  );
}

function CreateWorkspaceInline({ call, onCreated }: any) {
  const [name, setName] = useState('');
  const [vis, setVis] = useState('PRIVATE');
  function create() {
    call('POST /workspaces', () => api('/workspaces', { method: 'POST', body: { name, visibility: vis } }))
      .then(() => { setName(''); onCreated(); }).catch(() => {});
  }
  return (
    <div className="row">
      <input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={vis} onChange={(e) => setVis(e.target.value)}><option value="PRIVATE">PRIVATE</option><option value="PUBLIC">PUBLIC</option></select>
      <button className="primary" disabled={!name} onClick={create}>Create</button>
    </div>
  );
}

/* ===================== 2 · Workspace chooser (forced landing) ===================== */
function Chooser({ call, bar, isAdmin, onEnter, onAdmin, log }: any) {
  const mine = useList(call, '/workspaces');
  const disc = useList(call, '/workspaces/discoverable');
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const isPublic = (w: any) => w.visibility === 'PUBLIC';
  function enter(id: string) {
    call('POST /auth/workspace/enter', () => api('/auth/workspace/enter', { method: 'POST', body: { workspaceId: id } }))
      .then((d: any) => onEnter(id, d.accessToken)).catch(() => {});
  }
  function join(id: string) { call(`POST /workspaces/${id}/join`, () => api(`/workspaces/${id}/join`, { method: 'POST' })).then(() => enter(id)).catch(() => {}); }
  function request(id: string) { call(`POST /workspaces/${id}/requests`, () => api(`/workspaces/${id}/requests`, { method: 'POST', body: {} })).then(() => setRequested((r) => ({ ...r, [id]: true }))).catch(() => {}); }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <TopBar {...bar} right={isAdmin && <button onClick={onAdmin}>Admin console</button>} />
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '40px 20px' }}>
        <div className="card wide">
          <h1 className="ah1">Choose a workspace</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Pick a workspace to enter.{isAdmin ? ' As a realm admin you can enter any workspace.' : ''}
          </p>

          <h2 className="ah2" style={{ marginTop: 22 }}>Your workspaces</h2>
          <div className="ws-list">
            {mine.rows.map((w: any) => (
              <div key={w.id} className="ws-row">
                <span className="ws-emoji">{isPublic(w) ? '🌐' : '🔒'}</span>
                <div className="ws-meta"><div className="nm">{w.name}</div><div className="muted" style={{ fontSize: 12 }}>{w.role ?? 'member'}</div></div>
                <button className="primary" onClick={() => enter(w.id)}>Enter</button>
              </div>
            ))}
            {!mine.rows.length && <div className="ws-row muted">You're not in any workspaces yet.</div>}
          </div>

          <h2 className="ah2" style={{ marginTop: 22 }}>Request access — join public, request private</h2>
          <div className="ws-list">
            {disc.rows.map((w: any) => {
              const pub = isPublic(w);
              return (
                <div key={w.id} className="ws-row">
                  <span className="ws-emoji">{pub ? '🌐' : '🔒'}</span>
                  <div className="ws-meta"><div className="nm">{w.name}</div><div className="muted" style={{ fontSize: 12 }}>{pub ? 'Public' : 'Private'}</div></div>
                  <span className={`badge ${pub ? 'pub' : 'priv'}`}>{pub ? 'Public' : 'Private'}</span>
                  {pub ? <button onClick={() => join(w.id)}>Open</button>
                    : requested[w.id] ? <button disabled>Requested</button>
                      : <button onClick={() => request(w.id)}>Request access</button>}
                </div>
              );
            })}
            {!disc.rows.length && <div className="ws-row muted">No other workspaces to join.</div>}
          </div>

          {isAdmin && <div style={{ marginTop: 20 }}><h2 className="ah2">New workspace</h2><CreateWorkspaceInline call={call} onCreated={mine.refresh} /></div>}
        </div>
      </div>
      <DebugPanel log={log} />
    </div>
  );
}

/* ===================== 3 · Admin console (full screen) ===================== */
function AdminScreen({ call, bar, onBack, log }: any) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <TopBar {...bar} left={<button onClick={onBack}>← Back to workspaces</button>} />
      <div style={{ flex: 1, padding: 24, maxWidth: 980, width: '100%', margin: '0 auto' }}>
        <AdminConsole call={call} />
      </div>
      <DebugPanel log={log} />
    </div>
  );
}

/* ===================== 4 · Inside the chosen workspace ===================== */
function WorkspaceScreen({ call, bar, wsId, me, isAdmin, openDocId, onOpenDoc, onCloseDoc, onSwitch, onAdmin, log }: any) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <TopBar {...bar} left={<button onClick={onSwitch}>⇄ Switch workspace</button>} right={isAdmin && <button onClick={onAdmin}>Admin console</button>} />
      <div style={{ flex: 1, padding: 24, maxWidth: 1040, width: '100%', margin: '0 auto' }}>
        <InsideWorkspace call={call} wsId={wsId} me={me} openDocId={openDocId} onOpenDoc={onOpenDoc} onCloseDoc={onCloseDoc} />
      </div>
      <DebugPanel log={log} />
    </div>
  );
}

/* ============================== 1 · Auth ============================== */
function Auth({ call, onAuthed }: { call: any; onAuthed: (t: string, registered: boolean) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('owner@toddle.test');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  async function submit() {
    setNote(null);
    const path = mode === 'login' ? '/auth/login' : '/auth/register';
    const body = mode === 'login' ? { email, password } : { email, password, name };
    try {
      const d = await call(`POST ${path}`, () => api(path, { method: 'POST', body, auth: false }));
      if (d?.accessToken) onAuthed(d.accessToken, mode === 'register');
    } catch {
      setNote('Request failed — see the response panel below.');
    }
  }
  return (
    <div className="auth-wrap">
      <div className="card">
        <div className="brand" style={{ marginBottom: 2 }}>Toddle <span>Compose</span></div>
        <div className="muted" style={{ marginBottom: 16, fontSize: 13 }}>{mode === 'login' ? 'Sign in to reach your workspaces.' : 'One identity for every workspace.'}</div>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={mode === 'login' ? 'primary' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'register' ? 'primary' : ''} onClick={() => setMode('register')}>Register</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {mode === 'register' && <label>Full name<br /><input style={{ width: '100%', marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Rivera" /></label>}
          <label>Email<br /><input style={{ width: '100%', marginTop: 4 }} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<br /><input style={{ width: '100%', marginTop: 4 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary" onClick={submit} style={{ marginTop: 4 }}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
          {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
        </div>
      </div>
    </div>
  );
}

function Awaiting({ email, onContinue, onSignOut }: { email?: string; onContinue: () => void; onSignOut: () => void }) {
  return (
    <div className="auth-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="brand">Toddle <span>Compose</span></div>
        <div style={{ fontSize: 30, margin: '12px 0 4px' }}>✓</div>
        <h1 className="ah1">You're all set</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Your account is created. An admin needs to add you to a workspace before you can start —
          or find a public one to join.
        </p>
        <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          <button className="primary" onClick={onContinue}>Find a workspace to join</button>
        </div>
      </div>
      <div className="foot">Signed in as {email} · <a onClick={onSignOut}>Sign out</a></div>
    </div>
  );
}

/* ===================== shared list/table helpers ===================== */
function useList(call: any, path: string, deps: any[] = []) {
  const [rows, setRows] = useState<any[]>([]);
  const refresh = useCallback(() => {
    call(`GET ${path}`, () => api(path)).then((d: any) => setRows(asRows(d))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, deps);
  return { rows, refresh };
}
const email_ = (r: any) => r.email ?? r.user?.email ?? r.userEmail ?? '';
const name_ = (r: any) => r.name ?? r.user?.name ?? '';
const userId_ = (r: any) => r.userId ?? r.user?.id ?? r.id ?? '';

function RoleSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}
function NavBtn({ on, onClick, children }: any) {
  return <button onClick={onClick} className={on ? 'primary' : ''} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}>{children}</button>;
}
function Section({ title, onRefresh, children }: { title: string; onRefresh?: () => void; children: any }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="ah2">{title}</h2>
        {onRefresh && <button onClick={onRefresh}>Refresh</button>}
      </div>
      {children}
    </div>
  );
}

/* ===================== Realm admin console ===================== */
function AdminConsole({ call }: { call: any }) {
  const [tab, setTab] = useState('workspaces');
  return (
    <div>
      <h2 className="ah2">Realm admin console</h2>
      <div className="row" style={{ margin: '8px 0 4px' }}>
        <button className={tab === 'workspaces' ? 'primary' : ''} onClick={() => setTab('workspaces')}>Workspaces</button>
        <button className={tab === 'members' ? 'primary' : ''} onClick={() => setTab('members')}>Realm members</button>
        <button className={tab === 'requests' ? 'primary' : ''} onClick={() => setTab('requests')}>Join requests</button>
      </div>
      {tab === 'workspaces' && <AdminWorkspaces call={call} />}
      {tab === 'members' && <RealmMembers call={call} />}
      {tab === 'requests' && <RealmRequests call={call} />}
    </div>
  );
}

function AdminWorkspaces({ call }: { call: any }) {
  const { rows, refresh } = useList(call, '/workspaces');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('PRIVATE');
  function create() { call('POST /workspaces', () => api('/workspaces', { method: 'POST', body: { name, visibility } })).then(() => { setName(''); refresh(); }).catch(() => {}); }
  function rename(w: any) {
    const n = window.prompt('New workspace name', w.name);
    if (n && n !== w.name) call(`PATCH /workspaces/${w.id}`, () => api(`/workspaces/${w.id}`, { method: 'PATCH', body: { name: n } })).then(refresh).catch(() => {});
  }
  function del(w: any) {
    if (window.confirm(`Delete workspace "${w.name}"? This cannot be undone.`))
      call(`DELETE /workspaces/${w.id}`, () => api(`/workspaces/${w.id}`, { method: 'DELETE' })).then(refresh).catch(() => {});
  }
  return (
    <Section title="Workspaces" onRefresh={refresh}>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name" />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="PRIVATE">PRIVATE</option><option value="PUBLIC">PUBLIC</option></select>
        <button className="primary" disabled={!name} onClick={create}>Create</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>ID</th><th>My role</th><th></th></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td><td className="muted">{w.id}</td><td>{w.role ?? '—'}</td>
              <td className="row"><button onClick={() => rename(w)}>Rename</button><button className="danger" onClick={() => del(w)}>Delete</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="muted">No workspaces. (Realm-wide listing is membership-scoped; create one to manage it here.)</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}

function RealmMembers({ call }: { call: any }) {
  const { rows, refresh } = useList(call, '/realm/users');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  function add() { call('POST /realm/users', () => api('/realm/users', { method: 'POST', body: { email, role } })).then(() => { setEmail(''); refresh(); }).catch(() => {}); }
  function changeRole(uid: string, r: string) { call(`PATCH /realm/users/${uid}`, () => api(`/realm/users/${uid}`, { method: 'PATCH', body: { role: r } })).then(refresh).catch(() => {}); }
  function remove(uid: string, who: string) { if (window.confirm(`Remove ${who} from the realm?`)) call(`DELETE /realm/users/${uid}`, () => api(`/realm/users/${uid}`, { method: 'DELETE' })).then(refresh).catch(() => {}); }
  return (
    <Section title="Realm members" onRefresh={refresh}>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email of existing account" />
        <RoleSelect value={role} options={REALM_ROLES} onChange={setRole} />
        <button className="primary" disabled={!email} onClick={add}>Add member</button>
      </div>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const uid = userId_(m); const r = m.role ?? 'MEMBER'; const locked = r === 'OWNER';
            return (
              <tr key={uid}>
                <td>{email_(m)}</td><td>{name_(m)}</td>
                <td>{locked ? <span className="tag">OWNER (locked)</span> : <RoleSelect value={r} options={REALM_ROLES} onChange={(v) => changeRole(uid, v)} />}</td>
                <td>{!locked && <button className="danger" onClick={() => remove(uid, email_(m))}>Remove</button>}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={4} className="muted">No members (need realm admin rights).</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}

function RealmRequests({ call }: { call: any }) {
  const { rows, refresh } = useList(call, '/workspaces/join-requests');
  return <RequestsTable rows={rows} refresh={refresh} call={call} wsOf={(r) => r.workspaceId ?? r.workspace?.id} title="Join requests (realm-wide)" />;
}

/* ===================== Inside a workspace ===================== */
function InsideWorkspace({ call, wsId, me, openDocId, onOpenDoc, onCloseDoc }: { call: any; wsId: string; me: any; openDocId: string | null; onOpenDoc: (id: string) => void; onCloseDoc: () => void }) {
  const [tab, setTab] = useState('docs');

  if (openDocId) {
    return (
      <div style={{ height: 'calc(100vh - 130px)' }}>
        <DocView docId={openDocId} me={me} onBack={onCloseDoc} />
      </div>
    );
  }
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={tab === 'docs' ? 'primary' : ''} onClick={() => setTab('docs')}>Docs</button>
        <button className={tab === 'members' ? 'primary' : ''} onClick={() => setTab('members')}>Members</button>
        <button className={tab === 'requests' ? 'primary' : ''} onClick={() => setTab('requests')}>Requests</button>
      </div>
      {tab === 'docs' && <DocsPanel call={call} wsId={wsId} onOpen={onOpenDoc} />}
      {tab === 'members' && <WorkspaceMembers call={call} wsId={wsId} />}
      {tab === 'requests' && <WorkspaceRequests call={call} wsId={wsId} />}
    </div>
  );
}

/* folder tree + document list + create + open ----------------------- */
function DocsPanel({ call, wsId, onOpen }: { call: any; wsId: string; onOpen: (id: string) => void }) {
  const [folders, setFolders] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null); // null = root / whole workspace
  const [fname, setFname] = useState('');
  const [dtitle, setDtitle] = useState('');

  const loadFolders = useCallback(() => {
    call(`GET /folders`, () => api(`/folders?workspaceId=${wsId}`)).then((d: any) => setFolders(asRows(d))).catch(() => {});
  }, [call, wsId]);
  const loadDocs = useCallback(() => {
    const q = folderId ? `?folderId=${folderId}` : `?workspaceId=${wsId}`;
    call(`GET /documents${q}`, () => api(`/documents${q}`)).then((d: any) => setDocs(asRows(d))).catch(() => {});
  }, [call, wsId, folderId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  function createFolder() {
    const body: any = { name: fname, workspaceId: wsId };
    if (folderId) body.parentId = folderId;
    call('POST /folders', () => api('/folders', { method: 'POST', body })).then(() => { setFname(''); loadFolders(); }).catch(() => {});
  }
  function createDoc() {
    const body: any = { title: dtitle || 'Untitled', workspaceId: wsId };
    if (folderId) body.folderId = folderId;
    call('POST /documents', () => api('/documents', { method: 'POST', body })).then((d: any) => { setDtitle(''); loadDocs(); if (d?.id) onOpen(d.id); }).catch(() => {});
  }
  function delFolder(f: any) {
    if (window.confirm(`Delete folder "${f.name}"?`)) call(`DELETE /folders/${f.id}`, () => api(`/folders/${f.id}`, { method: 'DELETE' })).then(() => { if (folderId === f.id) setFolderId(null); loadFolders(); }).catch(() => {});
  }
  function delDoc(d: any) {
    if (window.confirm(`Delete "${d.title ?? d.id}"?`)) call(`DELETE /documents/${d.id}`, () => api(`/documents/${d.id}`, { method: 'DELETE' })).then(loadDocs).catch(() => {});
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* folder tree */}
      <div style={{ width: 240, flexShrink: 0 }}>
        <h2 className="ah2">Folders</h2>
        <NavBtn on={folderId === null} onClick={() => setFolderId(null)}>All / root</NavBtn>
        {folders.map((f) => (
          <div key={f.id} className="row" style={{ justifyContent: 'space-between' }}>
            <button className={folderId === f.id ? 'primary' : ''} style={{ flex: 1, textAlign: 'left', paddingLeft: f.parentId ? 20 : 10 }} onClick={() => setFolderId(f.id)}>{f.name}</button>
            <button className="danger" title="Delete folder" onClick={() => delFolder(f)}>✕</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input value={fname} onChange={(e) => setFname(e.target.value)} placeholder="New folder" style={{ width: 130 }} />
          <button className="primary" disabled={!fname} onClick={createFolder}>Add</button>
        </div>
      </div>

      {/* docs list */}
      <div style={{ flex: 1 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="ah2">Documents {folderId ? '· in folder' : '· whole workspace'}</h2>
          <button onClick={loadDocs}>Refresh</button>
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <input value={dtitle} onChange={(e) => setDtitle(e.target.value)} placeholder="New document title" />
          <button className="primary" onClick={createDoc}>Create &amp; open</button>
        </div>
        <table>
          <thead><tr><th>Title</th><th>Visibility</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td><a onClick={() => onOpen(d.id)}>{d.title ?? '(untitled)'}</a></td>
                <td>{d.visibility ?? ''}</td>
                <td className="row"><button onClick={() => onOpen(d.id)}>Open</button><button className="danger" onClick={() => delDoc(d)}>Delete</button></td>
              </tr>
            ))}
            {!docs.length && <tr><td colSpan={3} className="muted">No documents here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceMembers({ call, wsId }: { call: any; wsId: string }) {
  const { rows, refresh } = useList(call, `/workspaces/${wsId}/users`, [wsId]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('READ');
  function add() { call(`POST /workspaces/${wsId}/users`, () => api(`/workspaces/${wsId}/users`, { method: 'POST', body: { email, role } })).then(() => { setEmail(''); refresh(); }).catch(() => {}); }
  function changeRole(uid: string, r: string) { call(`PATCH /workspaces/${wsId}/users/${uid}`, () => api(`/workspaces/${wsId}/users/${uid}`, { method: 'PATCH', body: { role: r } })).then(refresh).catch(() => {}); }
  function remove(uid: string, who: string) { if (window.confirm(`Remove ${who} from this workspace?`)) call(`DELETE /workspaces/${wsId}/users/${uid}`, () => api(`/workspaces/${wsId}/users/${uid}`, { method: 'DELETE' })).then(refresh).catch(() => {}); }
  return (
    <Section title="Members" onRefresh={refresh}>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email of existing account" />
        <RoleSelect value={role} options={WS_ROLES} onChange={setRole} />
        <button className="primary" disabled={!email} onClick={add}>Add member</button>
      </div>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const uid = userId_(m); const r = m.role ?? 'READ'; const owner = r === 'OWNER';
            return (
              <tr key={uid}>
                <td>{email_(m)}</td><td>{name_(m)}</td>
                <td>{owner ? <span className="tag">OWNER</span> : <RoleSelect value={r} options={WS_ROLES} onChange={(v) => changeRole(uid, v)} />}</td>
                <td>{!owner && <button className="danger" onClick={() => remove(uid, email_(m))}>Remove</button>}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={4} className="muted">No members (need workspace admin rights).</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}
function WorkspaceRequests({ call, wsId }: { call: any; wsId: string }) {
  const { rows, refresh } = useList(call, `/workspaces/${wsId}/requests`, [wsId]);
  return <RequestsTable rows={rows} refresh={refresh} call={call} wsOf={() => wsId} title="Join requests" />;
}

/* request list — used by both realm-wide and workspace-scoped views */
function RequestsTable({ rows, refresh, call, wsOf, title }: { rows: any[]; refresh: () => void; call: any; wsOf: (r: any) => string; title: string }) {
  function approve(r: any, grant: string) {
    const ws = wsOf(r);
    call('POST approve', () => api(`/workspaces/${ws}/requests/${r.id}/approve`, { method: 'POST', body: { role: grant } })).then(refresh).catch(() => {});
  }
  function reject(r: any) {
    const ws = wsOf(r);
    call('POST reject', () => api(`/workspaces/${ws}/requests/${r.id}/reject`, { method: 'POST' })).then(refresh).catch(() => {});
  }
  return (
    <Section title={title} onRefresh={refresh}>
      <table>
        <thead><tr><th>User</th><th>Workspace</th><th>State</th><th>Grant role</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => <RequestRow key={r.id ?? i} r={r} wsOf={wsOf} onApprove={approve} onReject={reject} />)}
          {!rows.length && <tr><td colSpan={5} className="muted">No pending requests.</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}
function RequestRow({ r, wsOf, onApprove, onReject }: { r: any; wsOf: (r: any) => string; onApprove: (r: any, g: string) => void; onReject: (r: any) => void }) {
  const [grant, setGrant] = useState(r.requestedRole ?? 'READ');
  const pending = (r.state ?? 'PENDING') === 'PENDING';
  return (
    <tr>
      <td>{email_(r) || userId_(r)}</td>
      <td className="muted">{wsOf(r)}</td>
      <td>{r.state ?? 'PENDING'}</td>
      <td><RoleSelect value={grant} options={WS_ROLES} onChange={setGrant} /></td>
      <td className="row">
        <button disabled={!pending} onClick={() => onApprove(r, grant)}>Approve</button>
        <button className="danger" disabled={!pending} onClick={() => onReject(r)}>Reject</button>
      </td>
    </tr>
  );
}

/* collapsible debug panel (bottom-left) — last backend call's response */
function DebugPanel({ log }: { log: Log }) {
  const [open, setOpen] = useState(false);
  if (!log) return null;
  return (
    <div style={{ position: 'fixed', left: 14, bottom: 14, zIndex: 50 }}>
      {open && (
        <div style={{ marginBottom: 6, background: '#0f1115', color: '#d6dae0', borderRadius: 8, padding: '8px 12px', maxHeight: 300, overflow: 'auto', width: 'min(540px, 80vw)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}>
          <div style={{ color: log.ok ? '#5dd28a' : '#f08a8a', marginBottom: 4 }}>{log.ok ? '✓' : '✗'} {log.label}{log.status ? ` · ${log.status}` : ''}</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log.data, null, 2)}</pre>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} style={{ fontSize: 12, opacity: 0.9 }}>
        {log.ok ? '🟢' : '🔴'} API log {open ? '▾' : '▸'}
      </button>
    </div>
  );
}
