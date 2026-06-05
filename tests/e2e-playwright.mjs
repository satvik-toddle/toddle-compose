// End-to-end browser test of the RBAC + docs + collab flow.
// Run: node tests/e2e-playwright.mjs   (frontend :5173 + backend :4000 + rtc :4001 must be up)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://localhost:5173';
const OWNER = { email: 'owner@toddle.test', password: 'password123' };
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (n) => { results.push(['PASS', n]); console.log('  ✓', n); };
const bad = (n, e) => { results.push(['FAIL', n, String(e?.message || e)]); console.log('  ✗', n, '—', String(e?.message || e)); };
async function step(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e); } }

const wsName = 'PW-WS-' + Date.now();
const docTitle = 'PW-Doc';

function wireConsole(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') console.log(`   [${tag} console.error] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`   [${tag} pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) console.log(`   [${tag} HTTP ${r.status()}] ${r.request().method()} ${r.url()}`); });
}

// scope clicks to the left nav vs the main content (both contain same labels)
const navBtn = (p, name) => p.locator('nav').getByRole('button', { name, exact: true });
const mainBtn = (p, name) => p.locator('main').getByRole('button', { name: name instanceof RegExp ? name : name, exact: !(name instanceof RegExp) });

async function login(page, who) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.fill('input[type=password]', who.password);
  await page.locator('input').first().fill(who.email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await navBtn(page, 'Workspaces').waitFor({ timeout: 15000 });
}

async function enterWorkspace(page, name) {
  await navBtn(page, 'Workspaces').click();
  const row = page.locator('tr', { hasText: name });
  await row.first().waitFor({ timeout: 10000 });
  await row.first().getByRole('button', { name: /Enter|Re-enter/ }).click();
  await mainBtn(page, 'Docs').waitFor({ timeout: 10000 });
}

const editorSel = 'div[contenteditable="true"]';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  console.log('\n=== Tab 1 (owner) ===');
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  wireConsole(p1, 'p1');

  await step('login (owner)', () => login(p1, OWNER));

  await step('admin console → create workspace', async () => {
    await navBtn(p1, 'Admin console').click();
    await mainBtn(p1, 'Workspaces').click();
    await p1.fill('input[placeholder="New workspace name"]', wsName);
    await mainBtn(p1, 'Create').click();
    await p1.locator('tr', { hasText: wsName }).first().waitFor({ timeout: 10000 });
  });

  await step('enter workspace', () => enterWorkspace(p1, wsName));

  await step('create folder', async () => {
    await mainBtn(p1, 'Docs').click();
    await p1.fill('input[placeholder="New folder"]', 'PW Folder');
    await mainBtn(p1, 'Add').click();
    await p1.locator('button', { hasText: 'PW Folder' }).first().waitFor({ timeout: 8000 });
  });

  await step('create document → editor opens', async () => {
    await p1.fill('input[placeholder="New document title"]', docTitle);
    await mainBtn(p1, /Create.*open/).click();
    await p1.locator(editorSel).first().waitFor({ timeout: 15000 });
  });

  await step('RTC connects (status = connected)', async () => {
    await p1.locator('span.tag', { hasText: 'connected' }).first().waitFor({ timeout: 20000 });
  });

  await step('type into editor (tab1)', async () => {
    await p1.locator(editorSel).first().click();
    await p1.keyboard.type('Hello from tab one. ');
    await p1.waitForTimeout(800);
  });
  await p1.screenshot({ path: SHOTS + 'p1-editor.png' }).catch(() => {});

  // ---- Tab 2: same doc, second client ----
  console.log('\n=== Tab 2 (owner, 2nd client) — collaboration ===');
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  wireConsole(p2, 'p2');
  let collabConverged = false;

  await step('tab2 login + enter same workspace', async () => {
    await login(p2, OWNER);
    await enterWorkspace(p2, wsName);
  });

  await step('tab2 open same document', async () => {
    await mainBtn(p2, 'Docs').click();
    // doc may be in the folder — select folder then open, fall back to whole-workspace list
    const link = p2.getByText(docTitle, { exact: false }).first();
    await link.waitFor({ timeout: 10000 });
    await link.click();
    await p2.locator(editorSel).first().waitFor({ timeout: 15000 });
    await p2.locator('span.tag', { hasText: 'connected' }).first().waitFor({ timeout: 20000 });
  });

  await step('collab: tab1 text appears in tab2', async () => {
    await p2.waitForFunction(
      () => (document.querySelector('div[contenteditable="true"]')?.innerText || '').includes('Hello from tab one'),
      undefined, { timeout: 15000 },
    );
    collabConverged = true;
  });

  await step('collab: tab2 edit appears in tab1', async () => {
    await p2.locator(editorSel).first().click();
    await p2.keyboard.type('Reply from tab two.');
    await p1.waitForFunction(
      () => (document.querySelector('div[contenteditable="true"]')?.innerText || '').includes('Reply from tab two'),
      undefined, { timeout: 15000 },
    );
  });
  await p1.screenshot({ path: SHOTS + 'p1-after-collab.png' }).catch(() => {});
  await p2.screenshot({ path: SHOTS + 'p2-after-collab.png' }).catch(() => {});

  // ---- Admin: realm members ----
  console.log('\n=== Admin: realm members + requests ===');
  await step('add realm member (alice as MAINTAINER)', async () => {
    await navBtn(p1, 'Leave').click().catch(() => {});
    await navBtn(p1, 'Admin console').click();
    await mainBtn(p1, 'Realm members').click();
    await p1.locator('input[placeholder="email of existing account"]').fill('alice@toddle.test');
    await p1.locator('main select').first().selectOption('MAINTAINER').catch(() => {});
    await mainBtn(p1, 'Add member').click();
    await p1.locator('tr', { hasText: 'alice@toddle.test' }).first().waitFor({ timeout: 10000 });
  });

  await step('join requests tab loads', async () => {
    await mainBtn(p1, 'Join requests').click();
    await p1.getByText('Join requests (realm-wide)').first().waitFor({ timeout: 8000 });
  });

  await browser.close();

  // ---- summary ----
  console.log('\n========== SUMMARY ==========');
  const fails = results.filter((r) => r[0] === 'FAIL');
  for (const r of results) console.log(`${r[0] === 'PASS' ? '✓' : '✗'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
  console.log(`\n${results.length - fails.length}/${results.length} passed · collab converged: ${collabConverged}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
