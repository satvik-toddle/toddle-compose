// Verifies the DOC version-history feature end-to-end against the local stack:
//   1. create a DOC, type into it (generates rtc update-log rows / a session)
//   2. open ?history=true -> left panel lists versions
//   3. click a version -> right panel renders that snapshot, read-only
//
// Prereqs: postgres + backend :4000 + rtc :4001 + frontend :5173, seeded.
// Run: node tests/doc-history.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const PW = 'password123';
const EDITOR = '.ds-de-contentEditable';
const ART = path.join(__dirname, 'artifacts', 'doc-history');
const TYPED = 'Version history smoke test line one.';

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
  const doc = await j('/documents', { method: 'POST', token, body: { workspaceId: ws.id, title: 'History Test Doc', type: 'DOC' } });
  console.log(`ws=${ws.id} doc=${doc.id}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  // The app persists only the refresh token (zustand `tc-auth`) and re-mints the
  // access token on boot, re-entering `lastActiveWorkspaceId`.
  await ctx.addInitScript(({ refresh, wsId }) => {
    localStorage.setItem(
      'tc-auth',
      JSON.stringify({ state: { refreshToken: refresh, lastActiveWorkspaceId: wsId }, version: 0 }),
    );
  }, { refresh: login.refreshToken, wsId: ws.id });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  // --- edit the doc to produce a real edit session ---
  await page.goto(`${APP}/w/${ws.id}?doc=${doc.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(2000); // let the RTC provider connect before typing
  await page.locator(EDITOR).click();
  await page.keyboard.type(TYPED, { delay: 20 });
  await sleep(4000); // > RTC_DEBOUNCE_IDLE_MS (2s) so the update is persisted

  const hist = await j(`/documents/${doc.id}/history`, { token });
  ok(hist.sessions.length >= 1, `history API returned a session (got ${hist.sessions.length})`);
  const seq = hist.sessions[0]?.lastSeq;
  if (seq != null) {
    // DOC snapshots return the server-extracted editorState (lexicalJson, upload URLs
    // materialized); the rendered text is asserted against the editor below.
    const snap = await j(`/documents/${doc.id}/history/${seq}`, { token });
    ok(!!snap.lexicalJson, `snapshot API returns the extracted editorState for the DOC`);
  }

  // --- open history mode via the Page actions dropdown ("Version history" menu item) ---
  await page.locator('[aria-label="Page actions"]').last().click();
  await page
    .locator('.ant-dropdown-menu li[role="menuitem"]', { hasText: 'Version history' })
    .first()
    .click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('history') === 'true', { timeout: 5000 });
  ok(true, 'History button set ?history=true');

  // left panel shows the versions heading + at least one row
  await page.waitForSelector('text=Version history', { timeout: 5000 });
  const rows = page.locator('button[aria-current]');
  await rows.first().waitFor({ timeout: 8000 });
  ok((await rows.count()) >= 1, `versions panel lists ${await rows.count()} version(s)`);

  // click the first version and confirm the snapshot renders the typed text, read-only
  await rows.first().click();
  await page.waitForSelector(EDITOR, { timeout: 15000 });
  await page.waitForFunction(
    (t) => document.querySelector('.ds-de-contentEditable')?.textContent?.includes(t),
    TYPED,
    { timeout: 15000 },
  );
  const editable = await page.locator(EDITOR).first().getAttribute('contenteditable');
  ok(editable === 'false', `snapshot editor is read-only (contenteditable=${editable})`);
  const bodyText = await page.locator(EDITOR).first().textContent();
  ok((bodyText || '').includes(TYPED), 'snapshot pane renders the historical text');

  await page.screenshot({ path: path.join(ART, 'history-view.png'), fullPage: false });
  console.log('  screenshot -> ' + path.join(ART, 'history-view.png'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
