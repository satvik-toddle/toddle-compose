// Functional API tests for the RBAC + docs + rtc features.
// Backend must be on :4000. Uses seeded users (password123).
const B = process.env.API || 'http://localhost:4000/api';
const PW = 'password123';
const results = [];
const ok = (n) => { results.push(true); console.log('  ✓', n); };
const bad = (n, d) => { results.push(false); console.log('  ✗', n, '—', typeof d === 'string' ? d : JSON.stringify(d)); };
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

async function req(method, path, { token, body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: res.status, data };
}
const login = async (email) => (await req('POST', '/auth/login', { body: { email, password: PW } })).data;
const ts = Date.now();

(async () => {
  console.log('\n=== auth + refresh token ===');
  const o = await login('owner@toddle.test');
  check('owner login returns access+refresh', !!o.accessToken && !!o.refreshToken, o);
  const r1 = await req('POST', '/auth/refresh', { body: { refreshToken: o.refreshToken } });
  check('refresh returns a new access token', r1.status === 201 || r1.status === 200, r1);
  const newAccess = r1.data?.accessToken;
  const me = await req('GET', '/auth/me', { token: newAccess });
  check('refreshed access token works on /auth/me', me.status === 200 && me.data?.user?.email === 'owner@toddle.test', me);
  const reuse = await req('POST', '/auth/refresh', { body: { refreshToken: o.refreshToken } });
  check('old refresh token is rotated/rejected', reuse.status >= 400, reuse);
  const owner = newAccess || o.accessToken;

  console.log('\n=== ensure member users in realm ===');
  for (const u of ['bob', 'carol', 'dave']) {
    const add = await req('POST', '/realm/users', { token: owner, body: { email: `${u}@toddle.test`, role: 'MEMBER' } });
    check(`realm has ${u} (add or already-member)`, add.status < 300 || add.status === 409, add);
  }

  console.log('\n=== workspace create (private + public) ===');
  const wsPriv = (await req('POST', '/workspaces', { token: owner, body: { name: `priv-${ts}`, visibility: 'PRIVATE' } })).data;
  const wsPub = (await req('POST', '/workspaces', { token: owner, body: { name: `pub-${ts}`, visibility: 'PUBLIC' } })).data;
  check('private workspace created', !!wsPriv?.id && wsPriv.visibility === 'PRIVATE', wsPriv);
  check('public workspace created', !!wsPub?.id && wsPub.visibility === 'PUBLIC', wsPub);

  console.log('\n=== request access → approve (request accept) ===');
  const bob = await login('bob@toddle.test');
  const reqRes = await req('POST', `/workspaces/${wsPriv.id}/requests`, { token: bob.accessToken, body: { requestedRole: 'EDIT' } });
  check('bob can request access to private workspace', reqRes.status < 300, reqRes);
  const list = await req('GET', `/workspaces/${wsPriv.id}/requests`, { token: owner });
  const pending = (Array.isArray(list.data) ? list.data : list.data?.items || []).find((r) => (r.user?.email || r.email) === 'bob@toddle.test' || r.userId);
  check('owner sees the pending request', !!pending, list);
  if (pending) {
    const appr = await req('POST', `/workspaces/${wsPriv.id}/requests/${pending.id}/approve`, { token: owner, body: { role: 'EDIT' } });
    check('owner approves the request', appr.status < 300, appr);
    const members = await req('GET', `/workspaces/${wsPriv.id}/users`, { token: owner });
    const isMember = (Array.isArray(members.data) ? members.data : members.data?.items || []).some((m) => (m.user?.email || m.email) === 'bob@toddle.test');
    check('bob is now a workspace member (EDIT)', isMember, members);
  }

  console.log('\n=== public join (instant) ===');
  const carol = await login('carol@toddle.test');
  const joinRes = await req('POST', `/workspaces/${wsPub.id}/join`, { token: carol.accessToken });
  check('carol joins public workspace instantly', joinRes.status < 300, joinRes);

  console.log('\n=== three-way RTC token role (editor / viewer / denied) ===');
  // owner creates a doc in the private workspace
  const ownerWs = (await req('POST', '/auth/workspace/enter', { token: owner, body: { workspaceId: wsPriv.id } })).data;
  const doc = (await req('POST', '/documents', { token: ownerWs.accessToken, body: { title: `doc-${ts}`, workspaceId: wsPriv.id } })).data;
  check('doc created in private workspace', !!doc?.id, doc);
  // add carol to the private ws as READ (viewer)
  await req('POST', `/workspaces/${wsPriv.id}/users`, { token: owner, body: { email: 'carol@toddle.test', role: 'READ' } });

  const bobTok = (await login('bob@toddle.test')).accessToken;
  const carolTok = (await login('carol@toddle.test')).accessToken;
  const daveTok = (await login('dave@toddle.test')).accessToken;

  const rtcBob = await req('POST', `/documents/${doc.id}/rtc-token`, { token: bobTok });
  check('EDIT member → rtc role "editor"', rtcBob.data?.role === 'editor', rtcBob);
  const rtcCarol = await req('POST', `/documents/${doc.id}/rtc-token`, { token: carolTok });
  check('READ member → rtc role "viewer"', rtcCarol.data?.role === 'viewer', rtcCarol);
  const rtcDave = await req('POST', `/documents/${doc.id}/rtc-token`, { token: daveTok });
  check('non-member → denied (403 or role "denied")', rtcDave.status === 403 || rtcDave.data?.role === 'denied', rtcDave);

  const pass = results.filter(Boolean).length;
  console.log(`\n========== ${pass}/${results.length} API checks passed ==========`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
