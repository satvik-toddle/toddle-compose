// Verifies the DOC version-DIFF feature end-to-end against the local stack:
//   1. create a DOC, type v1 (session 1), wait > 30s gap, retype v2 (session 2)
//   2. open ?history=true, toggle "Show changes" (?diff=true)
//   3. the diff pane renders diff-mark nodes: added runs (green) + removed runs (red)
//
// Prereqs: postgres + backend :4000 + rtc :4001 + frontend :5173, seeded.
// Run: NODE_PATH=<scratch>/node_modules node tests/doc-diff.playwright.cjs
// Fast mode: start rtc with RTC_SESSION_GAP_MS=3000 and run with GAP_WAIT_MS=5000.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const PW = 'password123';
const EDITOR = '.ds-de-contentEditable';
const ART = path.join(__dirname, 'artifacts', 'doc-diff');
// v1 -> v2: alpha/gamma/epsilon unchanged; beta,delta removed (red); BETA,zeta added (green).
const V1 = 'alpha beta gamma delta epsilon';
const V2 = 'alpha BETA gamma zeta epsilon';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(p, o = {}) {
  const r = await fetch(API + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${o.method || 'GET'} ${p} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const login = await j('/auth/login', { method: 'POST', body: { email: 'alice@toddle.test', password: PW } });
  const wss = await j('/workspaces', { token: login.accessToken });
  const ws = wss[0];
  const enter = await j('/auth/workspace/enter', { method: 'POST', token: login.accessToken, body: { workspaceId: ws.id } });
  const token = enter.accessToken;
  const doc = await j('/documents', { method: 'POST', token, body: { workspaceId: ws.id, title: 'Diff Test Doc', type: 'DOC' } });
  console.log(`ws=${ws.id} doc=${doc.id}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(({ refresh, wsId }) => {
    localStorage.setItem(
      'tc-auth',
      JSON.stringify({ state: { refreshToken: refresh, lastActiveWorkspaceId: wsId }, version: 0 }),
    );
  }, { refresh: login.refreshToken, wsId: ws.id });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  await page.goto(`${APP}/w/${ws.id}?doc=${doc.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(2000); // let the RTC provider connect before typing

  // --- session 1 (v1) ---
  await page.locator(EDITOR).click();
  await page.keyboard.type(V1, { delay: 20 });
  await sleep(4000); // > RTC debounce so v1 persists
  // Session gap must exceed the server's RTC_SESSION_GAP_MS (default 30s; see fast mode above).
  const gapWait = Number(process.env.GAP_WAIT_MS || 33000);
  console.log(`  typed v1, waiting out the session gap (${gapWait}ms)...`);
  await sleep(gapWait);
  await page.locator(EDITOR).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(V2, { delay: 20 });
  await sleep(4000);

  const hist = await j(`/documents/${doc.id}/history`, { token });
  console.log(`  history sessions: ${hist.sessions.length}`);
  ok(hist.sessions.length >= 2, `history API returned two edit sessions (got ${hist.sessions.length})`);

  // --- open history mode + toggle "Show changes" ---
  // History lives in the Page actions dropdown as a "Version history" menu item.
  await page.locator('[aria-label="Page actions"]').last().click();
  await page
    .locator('.ant-dropdown-menu li[role="menuitem"]', { hasText: 'Version history' })
    .first()
    .click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('history') === 'true', { timeout: 5000 });
  await page.waitForSelector('text=Version history', { timeout: 5000 });
  await page.locator('button[aria-current]').first().waitFor({ timeout: 8000 });

  const toggle = page.locator('[aria-label="Compare this version with the previous one"]');
  await toggle.first().waitFor({ timeout: 5000 });
  await toggle.first().click({ force: true });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('diff') === 'true', { timeout: 5000 });
  ok(true, 'toggle set ?diff=true');

  // --- assert the diff pane renders added + removed marks ---
  await page.waitForSelector(EDITOR, { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.ds-de-content-added, .ds-de-content-removed').length > 0,
    { timeout: 15000 },
  );
  const added = await page.locator('.ds-de-content-added').count();
  const removed = await page.locator('.ds-de-content-removed').count();
  console.log(`  added marks=${added} removed marks=${removed}`);
  ok(added >= 1, `renders added (green) diff marks (${added})`);
  ok(removed >= 1, `renders removed (red) diff marks (${removed})`);

  const addedText = (await page.locator('.ds-de-content-added').allTextContents()).join('|');
  const removedText = (await page.locator('.ds-de-content-removed').allTextContents()).join('|');
  console.log(`  added text: [${addedText}]  removed text: [${removedText}]`);
  ok(/BETA|zeta/.test(addedText), 'added marks contain the new words (BETA/zeta)');
  ok(/beta|delta/.test(removedText), 'removed marks contain the deleted words (beta/delta)');

  const editable = await page.locator(EDITOR).first().getAttribute('contenteditable');
  ok(editable === 'false', `diff editor is read-only (contenteditable=${editable})`);

  await page.screenshot({ path: path.join(ART, 'diff-view.png'), fullPage: false });
  console.log('  screenshot -> ' + path.join(ART, 'diff-view.png'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
