// "Import from Coda" workspace-import flow — driven through the REAL admin UI.
//   1. /admin/workspaces has an "Import workspace" button next to "New workspace".
//   2. Click it -> Import-from-Coda modal opens.
//   3. Credential auto-selects (one seeded); paste the Coda URL; click Validate.
//   4. Validation resolves: workspace-name prefilled "Sonu", page subtree, 13 pages.
//      (rename to "Sonu UI E2E" so the run is unique.)
//   5. Import -> toast + navigate to /admin/coda-import.
//   6. Poll the jobs UI until terminal; assert SUCCEEDED with 13/13.
//   7. /admin/workspaces lists the new "Sonu UI E2E" workspace.
//
// Prereqs: full stack up (backend :4000, rtc :4001, frontend :5173, import-worker :4100), seeded.
// Run: NODE_PATH=<scratch>/node_modules node tests/coda-import.playwright.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const CODA_URL = 'https://docs.superhuman.com/d/Dev-research-doc-5A_dYrsGSKG-tN/Sonu_sucGhEiu';
// Unique suffix so reruns don't collide with prior "Sonu UI E2E" workspaces.
const WS_NAME = `Sonu UI E2E ${Date.now().toString().slice(-5)}`;
const ART_DIR = path.join(__dirname, 'artifacts', 'coda-import');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(ART_DIR, name), fullPage: false });

async function api(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });

  // API login (owner = realm admin) -> refresh token to seed tc-auth.
  const login = await api('/auth/login', { method: 'POST', body: { email: 'owner@toddle.test', password: 'password123' } });
  if (login.status >= 400 || !login.data?.refreshToken) throw new Error('login failed: ' + JSON.stringify(login));
  const { refreshToken, accessToken } = login.data;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // Seed tc-auth ONCE; admin console needs no active workspace.
  await ctx.addInitScript((r) => {
    if (!localStorage.getItem('tc-auth')) {
      localStorage.setItem('tc-auth', JSON.stringify({ state: { refreshToken: r, lastActiveWorkspaceId: null }, version: 0 }));
    }
  }, refreshToken);

  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // ===== Step 1: workspaces admin + Import workspace button =====
  console.log('\n1. /admin/workspaces + Import workspace button:');
  await page.goto(`${APP}/admin/workspaces`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Workspaces', { timeout: 30000 });
  await page.getByRole('button', { name: 'New workspace' }).waitFor({ timeout: 15000 });
  await shot(page, '01-workspaces.png');
  const importBtn = page.getByRole('button', { name: 'Import workspace' });
  ok((await importBtn.count()) >= 1, '"Import workspace" button exists next to "New workspace"');

  // ===== Step 2: open modal =====
  console.log('\n2. Open Import-from-Coda modal:');
  await importBtn.first().click();
  await page.waitForSelector('text=Import from Coda', { timeout: 10000 });
  const urlInput = page.locator('[aria-label="Coda doc URL"]');
  await urlInput.waitFor({ timeout: 8000 });
  ok(true, 'Import-from-Coda modal opened (title + URL input present)');
  await shot(page, '02-modal.png');

  // ===== Step 3: credential + URL + Validate =====
  console.log('\n3. Credential auto-select + URL + Validate:');
  // The single seeded credential auto-selects on mount; the dropdown should show it,
  // not the placeholder. Confirm the placeholder is gone (a value is chosen).
  const placeholderVisible = await page.locator('text=Choose a Coda token').count();
  ok(placeholderVisible === 0, 'credential dropdown auto-selected the sole credential (no placeholder shown)');
  const credLabelShown = await page.locator('text=toddle coda (e2e)').count();
  ok(credLabelShown >= 1, 'dropdown displays the seeded credential label "toddle coda (e2e)"');

  await urlInput.click();
  await urlInput.fill(CODA_URL);
  const validateBtn = page.getByRole('button', { name: /Validate/ });
  await validateBtn.waitFor({ timeout: 5000 });
  ok(!(await validateBtn.isDisabled()), 'Validate button enabled once URL + credential are set');
  await validateBtn.click();

  // ===== Step 4: validation resolved =====
  console.log('\n4. Validation resolves (name prefill + page count):');
  const wsNameInput = page.locator('[aria-label="toddle-compose workspace name"]');
  await wsNameInput.waitFor({ timeout: 30000 });
  const prefilled = await wsNameInput.inputValue();
  ok(prefilled === 'Sonu', `workspace-name input prefilled with "Sonu" (saw "${prefilled}")`);
  const pageCountShown = await page.locator('text=/13\\s+pages will be imported/').count();
  ok(pageCountShown >= 1, 'modal shows "13 pages will be imported"');
  const subtreeShown = await page.locator('text=Importing page subtree').count();
  ok(subtreeShown >= 1, 'modal indicates a page subtree import');
  await shot(page, '03-validated.png');

  // Rename to a unique workspace name before importing.
  await wsNameInput.fill(WS_NAME);
  ok((await wsNameInput.inputValue()) === WS_NAME, `workspace name set to "${WS_NAME}"`);

  // ===== Step 5: Import -> toast + navigate =====
  console.log('\n5. Import -> toast + navigate to /admin/coda-import:');
  await page.getByRole('button', { name: /^Import$/ }).click();
  // Toast + navigation.
  const toastSeen = await page
    .waitForSelector('text=Import started', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  ok(toastSeen, 'success toast "Import started" shown');
  await page.waitForURL('**/admin/coda-import', { timeout: 10000 }).catch(() => {});
  ok(page.url().includes('/admin/coda-import'), `navigated to jobs view (${page.url()})`);
  await shot(page, '04-enqueued.png');

  // ===== Step 6: poll jobs UI to terminal =====
  console.log('\n6. Poll jobs UI until terminal (up to 4 min):');
  const deadline = Date.now() + 4 * 60 * 1000;
  let uiStatus = null;
  let progressText = '';
  const terminalLabels = ['Succeeded', 'Failed', 'Partial', 'Canceled'];
  while (Date.now() < deadline) {
    await page.goto(`${APP}/admin/coda-import`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Coda imports', { timeout: 20000 }).catch(() => {});
    // Find the row for our uniquely-named workspace.
    const row = page.locator(`tr:has-text("${WS_NAME}"), [role="row"]:has-text("${WS_NAME}")`).first();
    const rowCount = await row.count();
    if (rowCount > 0) {
      // Status is a colored icon whose name lives in a hover-only tooltip
      // (aria-labelledby target isn't in the DOM until hover), so classify by the
      // status cell's SVG class / spinner instead.
      const statusImg = row.locator('[role="img"]').first();
      uiStatus = (await statusImg.count())
        ? await statusImg.evaluate((el) => {
            if (el.querySelector('.animate-spin')) return 'Running';
            const svg = el.querySelector('svg')?.getAttribute('class') ?? '';
            if (svg.includes('icon-semantic-success')) return 'Succeeded';
            if (svg.includes('icon-semantic-critical') || svg.includes('icon-semantic-error')) return 'Failed';
            if (svg.includes('icon-semantic-warning')) return 'Partial';
            if (svg.includes('icon-semantic-subtle')) return 'Canceled';
            return 'Queued';
          })
        : null;
      const txt = await row.innerText().catch(() => '');
      const m = txt.match(/\d+\/\d+\s+done[^\n]*/);
      progressText = m ? m[0] : txt.replace(/\s+/g, ' ').trim();
      console.log(`    [poll] status=${uiStatus} progress="${progressText}"`);
      if (uiStatus && terminalLabels.includes(uiStatus)) break;
    } else {
      console.log('    [poll] row not found yet');
    }
    await sleep(5000);
  }
  ok(uiStatus === 'Succeeded', `job reached SUCCEEDED in UI (saw "${uiStatus}")`);
  ok(/13\/13\s+done/.test(progressText), `progress shows 13/13 done (saw "${progressText}")`);
  await shot(page, '05-job-succeeded.png');

  // Cross-check via API (secondary).
  const jobsApi = await api('/admin/coda-import/jobs', { token: accessToken });
  const apiJob = (jobsApi.data ?? []).find((j) => j.targetWorkspaceName === WS_NAME);
  console.log(`    [api] status=${apiJob?.status} ${apiJob?.succeededItems}/${apiJob?.totalItems}`);

  // ===== Step 7: workspace listed =====
  console.log('\n7. New workspace listed in /admin/workspaces:');
  await page.goto(`${APP}/admin/workspaces`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Workspaces', { timeout: 20000 });
  await page.waitForSelector(`text=${WS_NAME}`, { timeout: 10000 }).catch(() => {});
  ok((await page.locator(`text=${WS_NAME}`).count()) >= 1, `workspace "${WS_NAME}" appears in the list`);
  await shot(page, '06-workspace-listed.png');

  // ===== Step 8: console/page errors =====
  console.log('\n8. Browser errors:');
  console.log(`    console.error x${consoleErrors.length}, pageerror x${pageErrors.length}`);
  consoleErrors.slice(0, 15).forEach((e) => console.log('    [console.error] ' + e));
  pageErrors.slice(0, 15).forEach((e) => console.log('    [pageerror] ' + e));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
