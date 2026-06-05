import { useEffect, useState, useCallback } from 'react';
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
  const [token, setTok] = useState<string | null>(getToken());
  const [me, setMe] = useState<Me>(null);
  const [realm, setRealm] = useState<any>(null);
  const [activeWs, setActiveWs] = useState<string | null>(localStorage.getItem('tc_ws'));
  const [awaiting, setAwaiting] = useState(false); // post-register "awaiting access" screen
  const [nav, setNav] = useState('launcher'); // launcher | discover | admin | workspace
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

  function applyToken(t: string | null, ws: string | null) {
    setToken(t); setTok(t);
    if (ws) localStorage.setItem('tc_ws', ws); else localStorage.removeItem('tc_ws');
    setActiveWs(ws);
  }
  function logout() { applyToken(null, null); setMe(null); setRealm(null); setAwaiting(false); setNav('launcher'); }
  function enterWs(id: string, t: string) { applyToken(t, id); setNav('workspace'); }
  function leaveWs() {
    call('POST /auth/workspace/leave', () => api('/auth/workspace/leave', { method: 'POST' }))
      .then((d) => { applyToken(d.accessToken, null); setNav('launcher'); }).catch(() => {});
  }

  // 1 · Auth
  if (!token)
    return <Auth call={call} onAuthed={(t, registered) => { applyToken(t, null); setAwaiting(registered); setNav(registered ? 'discover' : 'launcher'); }} />;

  // 1b · awaiting access (just registered)
  if (awaiting)
    return <Awaiting email={me?.email} onBrowse={() => { setAwaiting(false); setNav('discover'); }} onContinue={() => { setAwaiting(false); setNav('launcher'); }} onSignOut={logout} />;

  const isAdmin = realm?.role === 'OWNER' || realm?.role === 'MAINTAINER';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* left nav — mirrors the design's sections */}
      <nav style={{ width: 220, borderRight: '1px solid #e9e9e7', padding: 16, background: '#fbfbfa', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Toddle Compose</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>{realm?.name ?? 'Realm'}</div>
        <NavBtn on={nav === 'launcher'} onClick={() => setNav('launcher')}>Workspaces</NavBtn>
        <NavBtn on={nav === 'discover'} onClick={() => setNav('discover')}>Request access</NavBtn>
        {isAdmin && <NavBtn on={nav === 'admin'} onClick={() => setNav('admin')}>Admin console</NavBtn>}
        {activeWs && <NavBtn on={nav === 'workspace'} onClick={() => setNav('workspace')}>Inside workspace</NavBtn>}
        <div style={{ marginTop: 24, borderTop: '1px solid #e9e9e7', paddingTop: 12, fontSize: 12 }}>
          <div>{me?.name ?? me?.email}</div>
          <div className="muted">{me?.email}</div>
          {realm?.role && <span className="tag" style={{ marginTop: 4, display: 'inline-block' }}>{realm.role}</span>}
          {activeWs && <div className="muted" style={{ marginTop: 6 }}>in: {activeWs}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            {activeWs && <button onClick={leaveWs}>Leave</button>}
            <button className="danger" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      <main style={{ flex: 1, padding: 24, maxWidth: 900 }}>
        {nav === 'launcher' && <Launcher call={call} activeWs={activeWs} onEnter={enterWs} isAdmin={isAdmin} goDiscover={() => setNav('discover')} goAdmin={() => setNav('admin')} />}
        {nav === 'discover' && <Discover call={call} />}
        {nav === 'admin' && isAdmin && <AdminConsole call={call} />}
        {nav === 'workspace' && activeWs && <InsideWorkspace call={call} wsId={activeWs} me={me} />}
        <DebugPanel log={log} />
      </main>
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
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 16px' }}>
      <h1 className="ah1" style={{ marginBottom: 4 }}>Toddle Compose</h1>
      <div className="muted" style={{ marginBottom: 16 }}>{mode === 'login' ? 'Sign in to reach your workspaces.' : 'One identity for every workspace.'}</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={mode === 'login' ? 'primary' : ''} onClick={() => setMode('login')}>Login</button>
        <button className={mode === 'register' ? 'primary' : ''} onClick={() => setMode('register')}>Register</button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {mode === 'register' && <label>Full name<br /><input style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Rivera" /></label>}
        <label>Email<br /><input style={{ width: '100%' }} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<br /><input style={{ width: '100%' }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary" onClick={submit}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
      </div>
      <DebugPanel log={null} />
    </div>
  );
}

function Awaiting({ email, onBrowse, onContinue, onSignOut }: { email?: string; onBrowse: () => void; onContinue: () => void; onSignOut: () => void }) {
  return (
    <div style={{ maxWidth: 440, margin: '90px auto', padding: '0 16px', textAlign: 'center' }}>
      <h1 className="ah1">You're all set</h1>
      <p className="muted">
        Your account is created. An admin needs to add you to a workspace before you can start —
        or you can find a workspace to join below.
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button className="primary" onClick={onBrowse}>Find a workspace to join</button>
        <button onClick={onContinue}>Go to my workspaces</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 16 }}>Signed in as {email} · <a onClick={onSignOut}>Sign out</a></div>
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

/* ===================== 2 · Workspace launcher ===================== */
function Launcher({ call, activeWs, onEnter, isAdmin, goDiscover, goAdmin }: any) {
  const { rows, refresh } = useList(call, '/workspaces');
  function enter(id: string) {
    call('POST /auth/workspace/enter', () => api('/auth/workspace/enter', { method: 'POST', body: { workspaceId: id } }))
      .then((d: any) => onEnter(id, d.accessToken)).catch(() => {});
  }
  return (
    <Section title="My workspaces" onRefresh={refresh}>
      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={goDiscover}>Find a workspace to join</button>
        {isAdmin && <button onClick={goAdmin}>Admin console</button>}
      </div>
      <table>
        <thead><tr><th>Name</th><th>ID</th><th>My role</th><th></th></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td><td className="muted">{w.id}</td><td>{w.role ?? w.myRole ?? '—'}</td>
              <td><button className={activeWs === w.id ? 'primary' : ''} onClick={() => enter(w.id)}>{activeWs === w.id ? 'Re-enter' : 'Enter'}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="muted">No workspaces yet. Use “Request access”, or create one in the admin console.</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}

/* ===================== 3 · Request access ===================== */
function Discover({ call }: { call: any }) {
  const { rows, refresh } = useList(call, '/workspaces/discoverable');
  const isPublic = (w: any) => w.joinPolicy === 'OPEN' || w.visibility === 'PUBLIC';
  function join(id: string) { call(`POST /workspaces/${id}/join`, () => api(`/workspaces/${id}/join`, { method: 'POST' })).then(refresh).catch(() => {}); }
  function request(id: string) { call(`POST /workspaces/${id}/requests`, () => api(`/workspaces/${id}/requests`, { method: 'POST', body: {} })).then(refresh).catch(() => {}); }
  return (
    <Section title="Find a workspace to join" onRefresh={refresh}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Open a public workspace right away, or request access to a private one — an admin approves it.</div>
      <table>
        <thead><tr><th>Name</th><th>ID</th><th>Visibility</th><th></th></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td><td className="muted">{w.id}</td>
              <td>{w.visibility ?? ''} {w.joinPolicy ? `· ${w.joinPolicy}` : ''}</td>
              <td>{isPublic(w) ? <button onClick={() => join(w.id)}>Join</button> : <button onClick={() => request(w.id)}>Request access</button>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="muted">No discoverable workspaces.</td></tr>}
        </tbody>
      </table>
    </Section>
  );
}

/* ===================== 4 · Realm admin console ===================== */
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

/* ===================== 5 · Inside a workspace ===================== */
function InsideWorkspace({ call, wsId, me }: { call: any; wsId: string; me: any }) {
  const [tab, setTab] = useState('docs');
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  if (openDoc) {
    return (
      <div style={{ height: 'calc(100vh - 48px)' }}>
        <DocView docId={openDoc} me={me} onBack={() => setOpenDoc(null)} />
      </div>
    );
  }
  return (
    <div>
      <h2 className="ah2">Inside workspace · {wsId}</h2>
      <div className="row" style={{ marginBottom: 4 }}>
        <button className={tab === 'docs' ? 'primary' : ''} onClick={() => setTab('docs')}>Docs</button>
        <button className={tab === 'members' ? 'primary' : ''} onClick={() => setTab('members')}>Members</button>
        <button className={tab === 'requests' ? 'primary' : ''} onClick={() => setTab('requests')}>Requests</button>
      </div>
      {tab === 'docs' && <DocsPanel call={call} wsId={wsId} onOpen={setOpenDoc} />}
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

/* debug panel — shows the last backend call's response */
function DebugPanel({ log }: { log: Log }) {
  if (!log) return null;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#0f1115', color: '#d6dae0', fontSize: 12, padding: '8px 16px', maxHeight: 200, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', pointerEvents: 'none', opacity: 0.95 }}>
      <div style={{ color: log.ok ? '#5dd28a' : '#f08a8a', marginBottom: 4 }}>{log.ok ? '✓' : '✗'} {log.label}{log.status ? ` · ${log.status}` : ''}</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log.data, null, 2)}</pre>
    </div>
  );
}
