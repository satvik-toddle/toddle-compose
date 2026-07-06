// Cross-workspace sharing E2E:
//   1. Share picker opens with an INITIAL list (empty query -> first 20 realm users, name asc).
//   2. Workspace admin grants a NON-member (bob) via the realm-wide picker.
//   3. Bob's launcher lists the workspace as a "Guest" row; Shared with me lists the doc; doc is editable.
//   4. A member with only workspace EDIT but doc-ADMIN grant (carol) can grant another user (dave).
//
// Prereqs: stack up (backend :4000, rtc :4001, frontend :5173), seeded.
// Run:  node tests/cross-workspace-share.playwright.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const API = "http://localhost:4000/api";
const APP = "http://localhost:5173";
const PW = "password123";
const EDITOR = ".ds-de-contentEditable";
const ART_DIR = path.join(__dirname, "artifacts", "doc-permissions");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS " + m); } else { fail++; console.log("  FAIL " + m); } };

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

// Opens the doc's Share modal (3-dots -> Share) from an already-open doc page.
async function openShareModal(page) {
  await page.locator('[aria-label="Page actions"]').last().click();
  await page.locator('.ant-dropdown-menu li[role="menuitem"]:has-text("Share")').first().click();
  await page.waitForSelector('text=People with access to this page', { timeout: 5000 });
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const stamp = Date.now();

  console.log("Setup: ws2 with owner + carol(EDIT member); bob & dave NOT members…");
  const owner = await login("owner@toddle.test");
  const bob = await login("bob@toddle.test");
  const carol = await login("carol@toddle.test");
  const ws = await must("/workspaces", { method: "POST", token: owner.accessToken, body: { name: `xws-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" } });
  const ownerWs = await must("/auth/workspace/enter", { method: "POST", token: owner.accessToken, body: { workspaceId: ws.id } });
  await must(`/workspaces/${ws.id}/users`, { method: "POST", token: ownerWs.accessToken, body: { email: "carol@toddle.test", role: "EDIT" } });
  const doc = await must("/documents", { method: "POST", token: ownerWs.accessToken, body: { title: "doc1", workspaceId: ws.id } });
  const docUrl = `${APP}/w/${encodeURIComponent(ws.id)}?doc=${encodeURIComponent(doc.id)}`;

  const browser = await chromium.launch();

  // ===== 1+2. Owner shares with NON-member bob via the picker (initial list, no typing) =====
  console.log("\n1. Owner UI — initial list + cross-workspace grant:");
  const o = await openApp(browser, { refresh: owner.refreshToken, wsId: ws.id, url: docUrl, tag: "owner" });
  await o.page.waitForSelector(EDITOR, { timeout: 30000 });
  await openShareModal(o.page);
  await o.page.locator('[data-test-id="doc-perm-users-select-button"]').click();
  // No typing: the empty-query initial list must populate (first 20 realm users, name asc).
  const bobOption = o.page.locator('[data-test-id^="doc-perm-users-select-item-"]:has-text("Bob")').first();
  await bobOption.waitFor({ timeout: 8000 });
  // Option innerText = "<avatar initials>\n<name>\n<email>"; a "Select all" row precedes the users.
  const optionLabels = (await o.page.locator('[data-test-id^="doc-perm-users-select-item-"]').allInnerTexts()).filter((t) => t.includes("\n"));
  ok(optionLabels.length >= 3 && optionLabels.length <= 20, `picker opens pre-populated without typing (${optionLabels.length} options)`);
  const names = optionLabels.map((t) => t.split("\n")[1].trim());
  ok(JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))), `initial list is alphabetical (${names.join(", ")})`);
  await o.page.screenshot({ path: path.join(ART_DIR, "picker-initial-list.png") });
  await bobOption.click();
  await o.page.locator('button:has-text("Add")').last().click();
  await o.page.waitForSelector('text=bob@toddle.test', { timeout: 8000 });
  ok(true, "non-member bob granted via UI picker (EDIT default)");
  await o.page.keyboard.press("Escape");

  // ===== 3. Bob discovers the workspace: launcher guest row -> Shared with me -> edit =====
  console.log("\n2. Bob (non-member) — launcher discovery + Shared with me:");
  let r = await api(`/workspaces`, { token: bob.accessToken });
  const guestRow = (r.data || []).find((w) => w.id === ws.id);
  ok(!!guestRow && guestRow.guest === true && guestRow.role === "READ", `bob's workspace list includes ws as guest row (guest=${guestRow?.guest})`);
  const b = await openApp(browser, { refresh: bob.refreshToken, wsId: ws.id, url: `${APP}/`, tag: "bob" });
  await b.page.waitForSelector(`text=xws-${stamp}`, { timeout: 30000 });
  ok(await b.page.locator('text=Guest').count() >= 1, 'launcher shows a "Guest" tag on the grant-only workspace');
  await b.page.screenshot({ path: path.join(ART_DIR, "launcher-guest-row.png") });
  await b.page.goto(`${APP}/w/${encodeURIComponent(ws.id)}/shared`, { waitUntil: "domcontentloaded" });
  await b.page.waitForSelector("text=doc1", { timeout: 15000 });
  ok(true, "bob's Shared with me lists doc1");
  await b.page.click("text=doc1");
  await b.page.waitForSelector(EDITOR, { timeout: 30000 });
  const marker = `xws-bob-${stamp}`;
  await b.page.click(EDITOR);
  await b.page.keyboard.type(marker, { delay: 20 });
  await o.page.waitForSelector(`${EDITOR} >> text=${marker}`, { timeout: 15000 });
  ok(true, "bob opens doc1 from Shared with me and edits are visible to the owner");

  // ===== 4. Carol (ws EDIT, doc ADMIN) grants dave =====
  console.log("\n3. Carol (workspace EDIT + doc ADMIN) grants dave:");
  const grants = await must(`/documents/${doc.id}/permissions`, { token: ownerWs.accessToken });
  const carolId = (await must("/realm/users/search?q=carol", { token: ownerWs.accessToken }))[0].id;
  void grants;
  await must(`/documents/${doc.id}/permissions`, { method: "POST", token: ownerWs.accessToken, body: { email: "carol@toddle.test", role: "ADMIN" } });
  const c = await openApp(browser, { refresh: carol.refreshToken, wsId: ws.id, url: docUrl, tag: "carol" });
  await c.page.waitForSelector(EDITOR, { timeout: 30000 });
  await openShareModal(c.page);
  ok(true, "carol (EDIT member, doc-ADMIN grantee) can open the Share manager");
  await c.page.locator('[data-test-id="doc-perm-users-select-button"]').click();
  const daveOption = c.page.locator('[data-test-id^="doc-perm-users-select-item-"]:has-text("Dave")').first();
  await daveOption.waitFor({ timeout: 8000 });
  await daveOption.click();
  await c.page.locator('button:has-text("Add")').last().click();
  await c.page.waitForSelector('text=dave@toddle.test', { timeout: 8000 });
  ok(true, "carol grants dave (EDIT) on doc1 via UI");
  // Sanity: dave (non-member) can now read the doc via API.
  const dave = await login("dave@toddle.test");
  const daveWs = await must("/auth/workspace/enter", { method: "POST", token: dave.accessToken, body: { workspaceId: ws.id } });
  r = await api(`/documents/${doc.id}`, { token: daveWs.accessToken });
  ok(r.status === 200 && r.data.myRole === "EDIT", `dave reads doc1 with myRole=EDIT (${r.status})`);
  ok(carolId !== undefined, "realm search resolves carol (typed query path)");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
