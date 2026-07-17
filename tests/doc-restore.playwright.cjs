// Verifies the DOC version-history RESTORE feature end-to-end against the local stack:
//   1. create a DOC, type v1 (session 1), wait out the session gap, type v2 (session 2)
//   2. open ?history=true, select the OLDER version (v1)
//   3. the banner shows a 14px "Viewing version …" line with a Restore button at its right
//   4. Restore -> confirm modal -> restore: content is rewritten to v1 as a NEW edit session,
//      history mode exits, and the live editor becomes editable again showing v1 content.
//
// This guards the two collab-write bugs the restore path hit: the observer must skip the
// binding's own writes (origin === binding), and Set/Map node props (e.g. CustomTableCellNode
// __borderTypes) must be excluded from sync or the node's text write is aborted mid-integrate.
//
// Prereqs: postgres + backend :4000 + rtc :4001 + frontend :5173, seeded.
// Run: NODE_PATH=<scratch>/node_modules node tests/doc-restore.playwright.cjs
// Fast mode: start rtc with RTC_SESSION_GAP_MS=3000 and run with GAP_WAIT_MS=5000.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const PW = 'password123';
const EDITOR = '.ds-de-contentEditable';
const ART = path.join(__dirname, 'artifacts', 'doc-restore');
const V1 = 'alpha bravo charlie';
const V2 = 'delta echo foxtrot';

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
  const doc = await j('/documents', { method: 'POST', token, body: { workspaceId: ws.id, title: 'Restore Test Doc', type: 'DOC' } });
  console.log(`ws=${ws.id} doc=${doc.id}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(({ refresh, wsId }) => {
    localStorage.setItem('tc-auth', JSON.stringify({ state: { refreshToken: refresh, lastActiveWorkspaceId: wsId }, version: 0 }));
  }, { refresh: login.refreshToken, wsId: ws.id });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  await page.goto(`${APP}/w/${ws.id}?doc=${doc.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(2000);

  // --- session 1 (v1) ---
  await page.locator(EDITOR).click();
  await page.keyboard.type(V1, { delay: 20 });
  await sleep(4000);
  const gapWait = Number(process.env.GAP_WAIT_MS || 33000);
  console.log(`  typed v1, waiting out the session gap (${gapWait}ms)...`);
  await sleep(gapWait);
  // --- session 2 (v2) ---
  await page.locator(EDITOR).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(V2, { delay: 20 });
  await sleep(4000);

  const hist = await j(`/documents/${doc.id}/history`, { token });
  ok(hist.sessions.length >= 2, `history has two edit sessions (got ${hist.sessions.length})`);
  // Oldest session = v1; sessions are newest-first.
  const v1Seq = hist.sessions[hist.sessions.length - 1].lastSeq;

  // --- enter history mode via the UI (a second page.goto would re-run addInitScript and
  // re-seed the now-rotated refresh token -> family-kill logout). ---
  await page.locator('[aria-label="Page actions"]').last().click();
  await page.locator('.ant-dropdown-menu li[role="menuitem"]', { hasText: 'Version history' }).first().click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('history') === 'true', { timeout: 5000 });
  // Select the OLDER version (v1): version rows are newest-first, click the last one.
  const rows = page.locator('button[aria-current]');
  await rows.first().waitFor({ timeout: 8000 });
  await rows.last().click();
  await page.waitForSelector(EDITOR, { timeout: 45000 });
  const bannerSpan = page.locator('span', { hasText: /^Viewing version/ }).first();
  await bannerSpan.waitFor({ timeout: 8000 });
  const fz = await bannerSpan.evaluate((el) => getComputedStyle(el.parentElement).fontSize);
  ok(fz === '14px', `banner font-size is 14px (got ${fz})`);
  const restoreBtn = page.locator('button', { hasText: /^Restore$/ }).first();
  ok(await restoreBtn.isVisible(), 'Restore button visible on the banner line');
  const sameLine = await page.evaluate(() => {
    const span = [...document.querySelectorAll('span')].find((s) => s.textContent.startsWith('Viewing version'));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore');
    if (!span || !btn) return false;
    const a = span.getBoundingClientRect(); const b = btn.getBoundingClientRect();
    return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 12 && b.left > a.right;
  });
  ok(sameLine, 'Restore button sits on the same line, right side');

  // --- restore ---
  await restoreBtn.click();
  await page.locator('text=Restore this version?').waitFor({ timeout: 5000 });
  ok(true, 'confirm modal opened');
  await page.locator('button', { hasText: /^Restore$/ }).last().click();
  await page.waitForSelector('text=Version restored', { timeout: 30000 });
  ok(true, 'success toast shown');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('history') === null, { timeout: 10000 });
  ok(true, 'history mode exited after restore');

  await page.waitForSelector(EDITOR, { timeout: 45000 });
  await sleep(4000);
  const editable = await page.locator(EDITOR).first().getAttribute('contenteditable');
  ok(editable === 'true', `live editor is editable again (contenteditable=${editable})`);
  const text = await page.locator(EDITOR).first().innerText();
  ok(text.includes('alpha bravo charlie'), 'live editor shows restored v1 content');
  ok(!text.includes('delta echo foxtrot'), 'v2-only content is gone after restore');

  // Server-side fidelity: the restore rewrote the doc back to v1 — the current HEAD text now
  // equals the v1 snapshot text exactly (proving a real write, since HEAD was v2 a moment ago).
  const after = await j(`/documents/${doc.id}/history`, { token });
  const headSeq = after.sessions[0].lastSeq;
  const headSnap = await j(`/documents/${doc.id}/history/${headSeq}`, { token });
  const v1Snap = await j(`/documents/${doc.id}/history/${v1Seq}`, { token });
  const plain = (json) => {
    let s = '';
    const walk = (n) => { if (typeof n.text === 'string') s += n.text + ' '; (n.children || []).forEach(walk); };
    walk(JSON.parse(json).root);
    return s.replace(/\s+/g, ' ').trim();
  };
  ok(plain(headSnap.lexicalJson) === plain(v1Snap.lexicalJson), 'restored HEAD text matches v1 exactly');

  await page.screenshot({ path: path.join(ART, 'restore-view.png'), fullPage: false });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
