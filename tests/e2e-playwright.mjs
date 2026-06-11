// End-to-end browser test: sign-in → forced chooser → enter → folders/docs →
// editor with live RTC collab → admin. Also checks URL state survives reload.
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
const editorSel = 'div[contenteditable="true"]';

function wire(page, tag) {
  page.on('pageerror', (e) => console.log(`   [${tag} pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) console.log(`   [${tag} HTTP ${r.status()}] ${r.request().method()} ${r.url()}`); });
}

async function login(page, who) {
  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type=password]', who.password);
  await page.locator('input').first().fill(who.email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Choose a workspace').waitFor({ timeout: 15000 });
}
const wsRow = (page, name) => page.locator('.ws-row', { hasText: name }).first();
async function enterWorkspace(page, name) {
  await wsRow(page, name).getByRole('button', { name: 'Enter' }).click();
  await page.getByRole('button', { name: 'Docs', exact: true }).waitFor({ timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  console.log('\n=== Tab 1 (owner) ===');
  const p1 = await (await browser.newContext()).newPage();
  wire(p1, 'p1');

  await step('sign in → lands on forced chooser', () => login(p1, OWNER));

  await step('create workspace from chooser', async () => {
    await p1.fill('input[placeholder="New workspace name"]', wsName);
    await p1.getByRole('button', { name: 'Create', exact: true }).click();
    await wsRow(p1, wsName).waitFor({ timeout: 10000 });
  });

  await step('enter workspace → URL is /ws/:id', async () => {
    await enterWorkspace(p1, wsName);
    if (!/\/ws\//.test(p1.url())) throw new Error('URL did not become /ws/:id — ' + p1.url());
  });

  await step('reload keeps you in the workspace (URL state)', async () => {
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.getByRole('button', { name: 'Docs', exact: true }).waitFor({ timeout: 10000 });
  });

  await step('create folder', async () => {
    await p1.getByRole('button', { name: 'Docs', exact: true }).click();
    await p1.fill('input[placeholder="New folder"]', 'PW Folder');
    await p1.getByRole('button', { name: 'Add', exact: true }).click();
    await p1.locator('button', { hasText: 'PW Folder' }).first().waitFor({ timeout: 8000 });
  });

  await step('create document → editor opens (URL /ws/:id/doc/:docId)', async () => {
    await p1.fill('input[placeholder="New document title"]', docTitle);
    await p1.getByRole('button', { name: /Create.*open/ }).click();
    await p1.locator(editorSel).first().waitFor({ timeout: 15000 });
    if (!/\/doc\//.test(p1.url())) throw new Error('doc URL missing — ' + p1.url());
  });

  await step('RTC connects (status = connected)', () =>
    p1.locator('span.tag', { hasText: 'connected' }).first().waitFor({ timeout: 20000 }));

  await step('type into editor (tab1)', async () => {
    await p1.locator(editorSel).first().click();
    await p1.keyboard.type('Hello from tab one. ');
    await p1.waitForTimeout(800);
  });

  console.log('\n=== Tab 2 (collaboration) ===');
  const p2 = await (await browser.newContext()).newPage();
  wire(p2, 'p2');
  let collab = false;

  await step('tab2 sign in + enter same workspace', async () => {
    await login(p2, OWNER);
    await enterWorkspace(p2, wsName);
  });

  await step('tab2 open same document', async () => {
    await p2.getByRole('button', { name: 'Docs', exact: true }).click();
    await p2.getByText(docTitle, { exact: false }).first().click();
    await p2.locator(editorSel).first().waitFor({ timeout: 15000 });
    await p2.locator('span.tag', { hasText: 'connected' }).first().waitFor({ timeout: 20000 });
  });

  await step('collab: tab1 text appears in tab2', async () => {
    await p2.waitForFunction(() => (document.querySelector('div[contenteditable="true"]')?.innerText || '').includes('Hello from tab one'), undefined, { timeout: 15000 });
    collab = true;
  });
  await step('collab: tab2 edit appears in tab1', async () => {
    await p2.locator(editorSel).first().click();
    await p2.keyboard.type('Reply from tab two.');
    await p1.waitForFunction(() => (document.querySelector('div[contenteditable="true"]')?.innerText || '').includes('Reply from tab two'), undefined, { timeout: 15000 });
  });
  await p1.screenshot({ path: SHOTS + 'flow-editor.png' }).catch(() => {});

  console.log('\n=== Admin ===');
  await step('open admin console → add realm member', async () => {
    await p1.getByRole('button', { name: 'Admin console' }).first().click();
    await p1.getByRole('button', { name: 'Realm members' }).click();
    await p1.locator('input[placeholder="email of existing account"]').fill('alice@toddle.test');
    await p1.locator('select').first().selectOption('MAINTAINER').catch(() => {});
    await p1.getByRole('button', { name: 'Add member' }).click();
    await p1.locator('tr', { hasText: 'alice@toddle.test' }).first().waitFor({ timeout: 10000 });
  });

  await browser.close();
  console.log('\n========== SUMMARY ==========');
  const fails = results.filter((r) => r[0] === 'FAIL');
  for (const r of results) console.log(`${r[0] === 'PASS' ? '✓' : '✗'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
  console.log(`\n${results.length - fails.length}/${results.length} passed · collab converged: ${collab}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
