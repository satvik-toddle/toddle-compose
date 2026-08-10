// Workspace membership-management authorization gates (API-only, no browser):
//   1. Nobody may change/remove a member whose REALM role is OWNER (403).
//   2. A realm MAINTAINER may only be changed/removed by the realm OWNER (403 otherwise).
//   3. Granting workspace ADMIN, or demoting/removing a member who currently holds workspace ADMIN,
//      is realm-admin-controlled; a plain workspace ADMIN (realm MEMBER) manages only non-admin
//      members. Exception: self-changes skip rule 3 (still subject to the last-admin guard + rules 1-2).
//   4. Non-admin member management (add/patch/remove READ/COMMENT/EDIT) stays allowed for ws ADMINs.
//   + listUsers rows carry each member's realmRole; last-admin guard still returns 409.
//
// Prereqs: backend up (:4000), seeded (owner from db:init; alice/bob/carol/dave/eve@toddle.test).
// Run:  node tests/workspace-admin-gates.playwright.cjs
const API = "http://localhost:4000/api";
const PW = "password123";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS " + m); } else { fail++; console.log("  FAIL " + m); } };

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const must = async (p, opts) => { const r = await api(p, opts); if (r.status >= 400) throw new Error(`${opts?.method || "GET"} ${p} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const login = async (email) => must("/auth/login", { method: "POST", body: { email, password: PW } });
const enter = (token, workspaceId) => must("/auth/workspace/enter", { method: "POST", token, body: { workspaceId } });

async function main() {
  const stamp = Date.now();

  console.log("Setup: log in seeded users…");
  const owner = await login("owner@toddle.test");
  const alice = await login("alice@toddle.test");
  const bob = await login("bob@toddle.test");
  const carol = await login("carol@toddle.test");
  const dave = await login("dave@toddle.test");
  const eve = await login("eve@toddle.test");
  const id = { owner: owner.user.id, alice: alice.user.id, bob: bob.user.id, carol: carol.user.id, dave: dave.user.id, eve: eve.user.id };

  // Ensure dave is a realm MAINTAINER (tolerate reruns: POST 409 -> PATCH).
  const promo = await api("/realm/users", { method: "POST", token: owner.accessToken, body: { email: "dave@toddle.test", role: "MAINTAINER" } });
  if (promo.status === 409) await must(`/realm/users/${id.dave}`, { method: "PATCH", token: owner.accessToken, body: { role: "MAINTAINER" } });
  else ok(promo.status === 201, `dave promoted to realm MAINTAINER (${promo.status})`);

  console.log("\nSetup: owner creates ws; adds alice+bob ADMIN, carol EDIT…");
  const ws = await must("/workspaces", { method: "POST", token: owner.accessToken, body: { name: `gates-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" } });
  const ownerWs = await enter(owner.accessToken, ws.id);
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "alice@toddle.test", role: "ADMIN" } });
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "bob@toddle.test", role: "ADMIN" } });
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "carol@toddle.test", role: "EDIT" } });

  // ===== A. listUsers rows carry realmRole =====
  console.log("\nA. listUsers exposes each member's realmRole:");
  const members = await must(`/workspaces/${ws.id}/users`, { token: ownerWs.accessToken });
  const rowOf = (uid) => members.find((m) => m.userId === uid);
  ok(rowOf(id.owner)?.realmRole === "OWNER", `owner row realmRole = "OWNER" (${rowOf(id.owner)?.realmRole})`);
  ok(rowOf(id.alice)?.realmRole === "MEMBER", `alice row realmRole = "MEMBER" (${rowOf(id.alice)?.realmRole})`);

  // ===== B. alice: plain ws ADMIN (realm MEMBER) =====
  console.log("\nB. alice (ws ADMIN, realm MEMBER):");
  const aliceWs = await enter(alice.accessToken, ws.id);
  const pu = (uid, role) => api(`/workspaces/${ws.id}/users/${uid}`, { method: "PATCH", token: aliceWs.accessToken, body: { role } });

  ok((await pu(id.owner, "READ")).status === 403, "PATCH owner's row -> 403 (rule 1)");
  ok((await pu(id.bob, "EDIT")).status === 403, "PATCH bob (ws ADMIN) -> 403 (rule 3)");
  ok((await api(`/workspaces/${ws.id}/users/${id.bob}`, { method: "DELETE", token: aliceWs.accessToken })).status === 403, "DELETE bob (ws ADMIN) -> 403 (rule 3)");
  ok((await pu(id.carol, "ADMIN")).status === 403, "PATCH carol -> ADMIN -> 403 (rule 3, granting admin)");
  ok((await api(`/workspaces/${ws.id}/users`, { method: "POST", token: aliceWs.accessToken, body: { email: "eve@toddle.test", role: "ADMIN" } })).status === 403, "POST eve as ADMIN -> 403 (rule 3, granting admin)");

  ok((await pu(id.carol, "READ")).status === 200, "PATCH carol -> READ -> 200 (non-admin management)");
  ok((await api(`/workspaces/${ws.id}/users`, { method: "POST", token: aliceWs.accessToken, body: { email: "eve@toddle.test", role: "EDIT" } })).status === 201, "POST eve as EDIT -> 201");
  ok((await api(`/workspaces/${ws.id}/users/${id.eve}`, { method: "DELETE", token: aliceWs.accessToken })).status === 200, "DELETE eve -> 200");
  ok((await pu(id.alice, "EDIT")).status === 200, "PATCH own row -> EDIT -> 200 (self-demote allowed)");
  await must(`/workspaces/${ws.id}/users/${id.alice}`, { method: "PATCH", token: ownerWs.accessToken, body: { role: "ADMIN" } });

  // ===== C. dave: realm MAINTAINER (acts as ws ADMIN via overlay) =====
  console.log("\nC. dave (realm MAINTAINER):");
  const daveWs = await enter(dave.accessToken, ws.id);
  const du = (uid, role) => api(`/workspaces/${ws.id}/users/${uid}`, { method: "PATCH", token: daveWs.accessToken, body: { role } });
  ok((await du(id.bob, "EDIT")).status === 200, "PATCH bob (ws ADMIN) -> EDIT -> 200 (realm admin demotes ws admin)");
  ok((await du(id.carol, "ADMIN")).status === 200, "PATCH carol -> ADMIN -> 200 (realm admin grants admin)");
  ok((await api(`/workspaces/${ws.id}/users/${id.carol}`, { method: "DELETE", token: daveWs.accessToken })).status === 200, "DELETE carol (ws ADMIN) -> 200 (realm admin removes ws admin)");
  ok((await du(id.owner, "READ")).status === 403, "PATCH owner's row -> 403 (rule 1, even for a maintainer)");

  // ===== D. owner may touch a maintainer's ws membership row =====
  console.log("\nD. owner manages a realm MAINTAINER's ws membership:");
  ok((await api(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "dave@toddle.test", role: "EDIT" } })).status === 201, "owner adds dave (maintainer) as member -> 201");
  ok((await api(`/workspaces/${ws.id}/users/${id.dave}`, { method: "PATCH", token: ownerWs.accessToken, body: { role: "COMMENT" } })).status === 200, "owner PATCHes dave's row -> 200 (owner may touch maintainers)");

  // ===== E. last-admin guard (409) — dave-created ws whose sole admin is a realm MEMBER =====
  console.log("\nE. last-admin guard still returns 409:");
  const lastWs = await must("/workspaces", { method: "POST", token: dave.accessToken, body: { name: `gates-last-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" } });
  const ownerLastWs = await enter(owner.accessToken, lastWs.id);
  await must(`/workspaces/${lastWs.id}/users`, { method: "POST", token: ownerLastWs.accessToken, body: { email: "alice@toddle.test", role: "ADMIN" } });
  await must(`/workspaces/${lastWs.id}/users/${id.dave}`, { method: "DELETE", token: ownerLastWs.accessToken });
  const aliceLastWs = await enter(alice.accessToken, lastWs.id);
  const r = await api(`/workspaces/${lastWs.id}/users/${id.alice}`, { method: "PATCH", token: aliceLastWs.accessToken, body: { role: "EDIT" } });
  ok(r.status === 409, `self-demote of the sole remaining admin -> 409 (${r.status})`);

  // Cleanup: demote dave back to realm MEMBER so reruns start clean.
  await api(`/realm/users/${id.dave}`, { method: "PATCH", token: owner.accessToken, body: { role: "MEMBER" } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
