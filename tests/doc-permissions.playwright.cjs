// Per-page permission grants ("Share") E2E — multi-user, real UI + API surface:
//   1. API: grant CRUD guards — unknown email 404, owner 409, create 201, duplicate 409, bad role 400.
//   2. UI (owner): doc 3-dots → Share opens the modal; multi-select two members; one Add grants both.
//   3. UI (EDIT grantee, NOT a workspace member): opens the doc URL as guest, editor is writable,
//      typed text syncs to the owner; sidebar shows only the granted doc; other docs 404.
//   4. UI (READ grantee): editor renders read-only (viewer RTC token; typing changes nothing).
//   5. "Shared with me": /w/:id/shared lists the granted doc with permission + shared date.
//   6. No cascade + role gates as grantee: EDIT → rename 200 / visibility 403; ADMIN → visibility 200.
//   7. Doc-shared email hits the mailer (asserted by the caller via backend console in dev mode).
//   8. Revocation: doc list 403s and GET doc → 404.
//
// Prereqs: stack up (backend :4000, rtc :4001, frontend :5173), seeded.
// Run:  node tests/doc-permissions.playwright.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const API = "http://localhost:4000/api";
const APP = "http://localhost:5173";
const PW = "password123";
const EDITOR = ".ds-de-contentEditable";
const ART_DIR = path.join(__dirname, "artifacts", "doc-permissions");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS " + msg); } else { fail++; console.log("  FAIL " + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const must = async (p, opts) => { const r = await api(p, opts); if (r.status >= 400) throw new Error(`${opts?.method || "GET"} ${p} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const login = async (email) => must("/auth/login", { method: "POST", body: { email, password: PW } });

async function openApp(browser, { refresh, wsId, url, tag }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ r, w }) => { if (!localStorage.getItem("tc-auth")) localStorage.setItem("tc-auth", JSON.stringify({ state: { refreshToken: r, lastActiveWorkspaceId: w }, version: 0 })); }, { r: refresh, w: wsId });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${tag}] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const stamp = Date.now();

  console.log("Setup: private workspace; carol+dave are members, bob is NOT…");
  const owner = await login("owner@toddle.test");
  const bob = await login("bob@toddle.test");
  const carol = await login("carol@toddle.test");
  const ws = await must("/workspaces", { method: "POST", token: owner.accessToken, body: { name: `perm-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" } });
  const ownerWs = await must("/auth/workspace/enter", { method: "POST", token: owner.accessToken, body: { workspaceId: ws.id } });
  // Members feed the Share modal's multi-select (READ so grants are what elevate them).
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "carol@toddle.test", role: "READ" } });
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "dave@toddle.test", role: "READ" } });
  const doc = await must("/documents", { method: "POST", token: ownerWs.accessToken, body: { title: "secret page", workspaceId: ws.id } });
  const subdoc = await must("/documents", { method: "POST", token: ownerWs.accessToken, body: { title: "secret sub-page", workspaceId: ws.id, parentId: doc.id } });
  const otherDoc = await must("/documents", { method: "POST", token: ownerWs.accessToken, body: { title: "other page", workspaceId: ws.id } });
  const docUrl = `${APP}/w/${encodeURIComponent(ws.id)}?doc=${encodeURIComponent(doc.id)}`;
  console.log(`  doc: ${docUrl}`);

  // ===== 1. API guards =====
  console.log("\n1. Grant API guards:");
  let r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "nobody@toddle.test", role: "EDIT" } });
  ok(r.status === 404, `unknown email -> 404 (${r.status}: ${r.data?.message})`);
  r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "owner@toddle.test", role: "ADMIN" } });
  ok(r.status === 409, `granting the owner -> 409 (${r.status}: ${r.data?.message})`);
  r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "bob@toddle.test", role: "OWNER" } });
  ok(r.status === 400, `invalid role value -> 400 (${r.status})`);
  r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "bob@toddle.test", role: "EDIT" } });
  ok(r.status === 201 && r.data?.role === "EDIT", `grant bob EDIT -> 201 (${r.status})`);
  const bobId = r.data?.userId;
  r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "bob@toddle.test", role: "ADMIN" } });
  ok(r.status === 409, `duplicate grant -> 409 (${r.status}: ${r.data?.message})`);
  r = await api(`/documents/${doc.id}/permissions`, { token: ownerWs.accessToken });
  ok(r.status === 200 && r.data?.length === 1 && r.data[0].user?.email === "bob@toddle.test", `list -> 1 row (bob, ${r.data?.[0]?.role})`);
  const bobWs = await must("/auth/workspace/enter", { method: "POST", token: bob.accessToken, body: { workspaceId: ws.id } });
  ok(bobWs.guest === true && bobWs.role === "READ", `bob enters workspace as guest (guest=${bobWs.guest}, role=${bobWs.role})`);
  r = await api(`/documents/${doc.id}/permissions`, { method: "POST", token: bobWs.accessToken, body: { email: "carol@toddle.test", role: "EDIT" } });
  ok(r.status === 403, `EDIT grantee cannot manage permissions -> 403 (${r.status})`);

  const browser = await chromium.launch();

  // ===== 2. Owner UI: 3-dots -> Share modal, multi-select add =====
  console.log("\n2. Owner UI — Share modal (multi-select):");
  const o = await openApp(browser, { refresh: owner.refreshToken, wsId: ws.id, url: docUrl, tag: "owner" });
  await o.page.waitForSelector(EDITOR, { timeout: 30000 });
  // Two "Page actions" kebabs exist (sidebar row + topbar); the topbar one is last.
  await o.page.locator('[aria-label="Page actions"]').last().click();
  const shareItem = o.page.locator('.ant-dropdown-menu li[role="menuitem"]:has-text("Share")').first();
  await shareItem.waitFor({ timeout: 5000 });
  ok(true, '3-dots menu shows a "Share" item');
  await shareItem.click();
  await o.page.waitForSelector('text=People with access to this page', { timeout: 5000 });
  ok(await o.page.locator('text=bob@toddle.test').count() === 1, "modal lists bob's existing grant");
  // Multi-select carol + dave from workspace members, one Add grants both (default role EDIT).
  const selectField = o.page.locator('[data-test-id="doc-perm-users-select-button"]');
  const memberOption = (name) => o.page.locator(`[data-test-id^="doc-perm-users-select-item-"]:has-text("${name}"), .react-select__option:has-text("${name}")`).first();
  await selectField.click();
  await o.page.keyboard.type('car');
  await memberOption('Carol').click();
  await o.page.keyboard.type('dav');
  await memberOption('Dave').click();
  await o.page.locator('button:has-text("Add")').last().click();
  await o.page.waitForSelector('text=carol@toddle.test', { timeout: 8000 });
  await o.page.waitForSelector('text=dave@toddle.test', { timeout: 8000 });
  ok(true, "one Add grants both selected members");
  ok(await o.page.locator('[data-test-id^="doc-perm-users-select-item-"]:visible').count() === 0, "granted members leave the option list");
  await o.page.screenshot({ path: path.join(ART_DIR, "share-modal.png") });
  // Change carol to READ via the row's inline role select, then remove dave.
  await o.page.keyboard.press("Escape");

  // Carol's grant becomes READ via API (row-level RoleSelect is covered by ds-web; keep the UI run lean).
  const carolRow = (await must(`/documents/${doc.id}/permissions`, { token: ownerWs.accessToken })).find((g) => g.user.email === "carol@toddle.test");
  await must(`/documents/${doc.id}/permissions/${carolRow.userId}`, { method: "PATCH", token: ownerWs.accessToken, body: { role: "READ" } });
  ok(true, "carol's grant set to READ (PATCH)");

  // ===== 3. Bob (EDIT grantee, non-member): guest entry + live editing =====
  console.log("\n3. EDIT grantee UI — guest access + collaborative editing:");
  const b = await openApp(browser, { refresh: bob.refreshToken, wsId: ws.id, url: docUrl, tag: "bob" });
  await b.page.waitForSelector(EDITOR, { timeout: 30000 });
  ok(true, "bob (non-member) reaches the doc editor via guest entry");
  const marker = `hello-from-bob-${stamp}`;
  await b.page.click(EDITOR);
  await b.page.keyboard.type(marker, { delay: 20 });
  await o.page.waitForSelector(`${EDITOR} >> text=${marker}`, { timeout: 15000 });
  ok(true, "bob's typed text syncs live to the owner (editor RTC role)");
  ok(await b.page.locator(`text=other page`).count() === 0, "sidebar hides non-granted docs from bob");
  ok(await b.page.locator(`text=secret sub-page`).count() === 0, "sidebar hides the sub-page (no cascade)");
  await b.page.screenshot({ path: path.join(ART_DIR, "bob-guest-view.png") });
  await b.page.goto(`${APP}/w/${encodeURIComponent(ws.id)}?doc=${encodeURIComponent(otherDoc.id)}`, { waitUntil: "domcontentloaded" });
  await sleep(2500);
  ok(await b.page.locator(`text=other page`).count() === 0, "direct URL to a non-granted doc shows nothing");

  // ===== 4. Carol (READ grant, READ member): read-only editor =====
  console.log("\n4. READ grantee UI — read-only editor:");
  const c = await openApp(browser, { refresh: carol.refreshToken, wsId: ws.id, url: docUrl, tag: "carol" });
  await c.page.waitForSelector(EDITOR, { timeout: 30000 });
  const before = await c.page.locator(EDITOR).innerText();
  await c.page.click(EDITOR).catch(() => {});
  await c.page.keyboard.type("should-not-appear", { delay: 15 });
  await sleep(1200);
  const after = await c.page.locator(EDITOR).innerText();
  ok(!after.includes("should-not-appear") && after.includes(marker), "READ grantee cannot type (viewer token, read-only editor)");

  // ===== 5. Shared with me =====
  console.log("\n5. Shared with me:");
  const carolWs = await must("/auth/workspace/enter", { method: "POST", token: carol.accessToken, body: { workspaceId: ws.id } });
  r = await api(`/documents/shared?workspaceId=${encodeURIComponent(ws.id)}`, { token: carolWs.accessToken });
  ok(r.status === 200 && r.data?.length === 1 && r.data[0].id === doc.id && !!r.data[0].sharedAt, `API shared list -> 1 row with sharedAt (${r.status})`);
  ok(await c.page.locator('text=Shared with me').count() >= 1, 'sidebar shows a "Shared with me" link');
  await c.page.locator('text=Shared with me').first().click();
  await c.page.waitForSelector('text=secret page', { timeout: 8000 });
  ok(true, "Shared with me view lists the granted doc");
  await c.page.screenshot({ path: path.join(ART_DIR, "shared-with-me.png") });

  // ===== 6. Role gates + no cascade (API, as bob) =====
  console.log("\n6. Role gates (API, as bob):");
  r = await api(`/documents/${subdoc.id}`, { token: bobWs.accessToken });
  ok(r.status === 404, `sub-page of granted doc -> 404 (no cascade) (${r.status})`);
  r = await api(`/documents/${doc.id}`, { method: "PATCH", token: bobWs.accessToken, body: { title: "secret page (bob)" } });
  ok(r.status === 200, `EDIT grantee rename -> 200 (${r.status})`);
  r = await api(`/documents/${doc.id}/visibility`, { method: "PATCH", token: bobWs.accessToken, body: { visibility: "PUBLIC" } });
  ok(r.status === 403, `EDIT grantee set visibility -> 403 (${r.status})`);
  await must(`/documents/${doc.id}/permissions/${bobId}`, { method: "PATCH", token: ownerWs.accessToken, body: { role: "ADMIN" } });
  r = await api(`/documents/${doc.id}/visibility`, { method: "PATCH", token: bobWs.accessToken, body: { visibility: "PRIVATE" } });
  ok(r.status === 200, `ADMIN grantee set visibility -> 200 (${r.status})`);
  r = await api(`/documents?workspaceId=${encodeURIComponent(ws.id)}`, { token: bobWs.accessToken });
  ok(r.status === 200 && r.data?.length === 1 && r.data[0].myRole === "ADMIN", `guest doc list -> only granted doc, myRole=ADMIN (${r.data?.length} docs)`);

  // ===== 7. Revocation =====
  console.log("\n7. Revocation:");
  await must(`/documents/${doc.id}/permissions/${bobId}`, { method: "DELETE", token: ownerWs.accessToken });
  r = await api(`/documents/${doc.id}`, { token: bobWs.accessToken });
  ok(r.status === 404, `revoked bob GET doc -> 404 (${r.status})`);
  r = await api(`/documents?workspaceId=${encodeURIComponent(ws.id)}`, { token: bobWs.accessToken });
  ok(r.status === 403, `revoked bob doc list -> 403 (${r.status})`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
