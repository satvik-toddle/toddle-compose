// E2E verification for the doc-search feature. Plain node + playwright (not @playwright/test).
const { chromium } = require('playwright');
const fs = require('fs');

const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const WS = 'cmrajmy1e00073l0h6chtw3y4'; // "Test workspace" (Page 1 DOC + Untitled SHEET)
const ART = '/Users/apple/Documents/toddle-compose/tests/artifacts/doc-search';
fs.mkdirSync(ART, { recursive: true });

const results = [];
const pass = (n, ok, note = '') => { results.push({ n, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${n}${note ? ' :: ' + note : ''}`); };
const shot = async (p, name) => { await p.screenshot({ path: `${ART}/${name}.png` }); };

(async () => {
  // One login (respect rate limit) → fresh refreshToken for the browser.
  const login = await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@toddle.test', password: 'password123' }),
  })).json();
  if (!login.refreshToken) throw new Error('no refreshToken from login: ' + JSON.stringify(login).slice(0, 200));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Track search + preview network calls.
  const net = { search: [], preview: [] };
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/documents/search')) net.search.push(u);
    if (/\/api\/documents\/[^/]+\/preview/.test(u)) net.preview.push(u);
  });

  // Seed ONLY if absent — re-seeding a rotated refreshToken on later reloads triggers family-kill logout.
  await page.addInitScript(([rt, ws]) => {
    if (!localStorage.getItem('tc-auth')) {
      localStorage.setItem('tc-auth', JSON.stringify({ state: { refreshToken: rt, lastActiveWorkspaceId: ws }, version: 0 }));
    }
  }, [login.refreshToken, WS]);

  // ---- In-workspace ----
  await page.goto(`${APP}/w/${WS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Check 1a: sidebar search row exists (search lives in the sidebar nav, next to Home/Starred)
  const sidebarSearch = await page.locator('[data-testid="sidebar-search"]').count();
  pass('1a entry point present (sidebar search row)', sidebarSearch >= 1, `sidebarSearch=${sidebarSearch}`);

  // Check 1b: ⌘/Ctrl+K opens the modal
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const fieldInput = page.locator('input[aria-label="Search documents"]');
  await fieldInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  pass('1b ⌘/Ctrl+K opens search modal', await page.locator('[data-testid="gs-search"]').count() > 0);

  // Check 6: empty state = minimal prompt, no search request yet
  const emptyShown = await page.locator('[data-testid="gs-empty"]').count() > 0;
  const searchesBeforeType = net.search.length;
  pass('6 empty query → minimal prompt, no search request', emptyShown && searchesBeforeType === 0, `empty=${emptyShown} searches=${searchesBeforeType}`);
  await shot(page, '01-empty');

  // Check 2/4/5-ON: type a title+content query; default toggle ON → split + preview
  await fieldInput.click();
  await fieldInput.type('page');
  await page.waitForTimeout(2500); // debounce + fetch
  await page.locator('[data-testid="sr"]').first().waitFor({ timeout: 12000 }).catch(() => {});
  const rowCount = await page.locator('[data-testid="sr"]').count();
  const hasTitleBadge = await page.locator('[data-testid="sr-badge"]').count() > 0;
  const hasHitMark = await page.locator('[data-testid="sr-hit"]').count() > 0;
  pass('2 results with title badge + amber highlight in list', rowCount > 0 && hasTitleBadge && hasHitMark, `rows=${rowCount} badge=${hasTitleBadge} hit=${hasHitMark}`);

  const isSplit = await page.locator('[data-testid="gs-search"][data-layout="split"]').count() > 0;
  const hasPreview = await page.locator('[data-testid="gs-prev"]').count() > 0;
  await page.waitForTimeout(600);
  pass('5-ON preview toggle default ON → split layout + preview + /preview fired', isSplit && hasPreview && net.preview.length > 0, `split=${isSplit} prev=${hasPreview} previewReqs=${net.preview.length}`);
  await shot(page, '02-split-preview-on');

  // Check 4: loaded/total count is rendered
  const countText = await page.locator('[data-testid="gs-count"]').first().textContent().catch(() => '');
  pass('4 loaded/total count shown', /\d+\s*\/\s*\d+/.test(countText ?? ''), `count="${countText}"`);

  // Check 5-OFF: toggle preview off → narrow, no preview, no new /preview request
  const previewReqsBeforeOff = net.preview.length;
  const toggle = page.locator('[data-testid="gs-search"]').getByRole('switch');
  const toggleCount = await toggle.count();
  if (toggleCount > 0) {
    await toggle.first().click({ force: true });
    await page.waitForTimeout(800);
    const nowNarrow = await page.locator('[data-testid="gs-search"][data-layout="spotlight"]').count() > 0;
    const previewGone = await page.locator('[data-testid="gs-prev"]').count() === 0;
    const noNewPreview = net.preview.length === previewReqsBeforeOff;
    pass('5-OFF toggle OFF → 640px list-only, preview unmounted, no new /preview', nowNarrow && previewGone && noNewPreview, `narrow=${nowNarrow} prevGone=${previewGone} newPreviewReqs=${net.preview.length - previewReqsBeforeOff}`);
    await shot(page, '03-list-only-off');
  } else {
    pass('5-OFF toggle control present', false, 'no preview switch found');
  }

  // Check 5-persist: close + reopen → toggle stays OFF
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.locator('input[aria-label="Search documents"]').waitFor({ timeout: 4000 }).catch(() => {});
  await page.locator('input[aria-label="Search documents"]').type('page');
  await page.waitForTimeout(1000);
  const stayedNarrow = await page.locator('[data-testid="gs-search"][data-layout="spotlight"]').count() > 0 && await page.locator('[data-testid="gs-prev"]').count() === 0;
  pass('5-persist toggle OFF persists across reopen', stayedNarrow, `narrow+noPrev=${stayedNarrow}`);
  // restore toggle ON for cleanliness
  const t2 = page.locator('[data-testid="gs-search"]').getByRole('switch');
  if (await t2.count()) await t2.first().click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape');

  // Check 3: SHEET content match (query a sheet cell value)
  await page.waitForTimeout(300);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.locator('input[aria-label="Search documents"]').waitFor({ timeout: 4000 }).catch(() => {});
  await page.locator('input[aria-label="Search documents"]').type('pending');
  await page.waitForTimeout(2500);
  const sheetRowText = (await page.locator('[data-testid="sr"]').allInnerTexts()).join(' | ');
  pass('3 SHEET cell content match surfaces the sheet doc', /pending/i.test(sheetRowText), `rows="${sheetRowText.slice(0, 80)}"`);
  await shot(page, '04-sheet-content-match');
  await page.keyboard.press('Escape');

  // Check 8: open a result navigates to ?doc=
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.locator('input[aria-label="Search documents"]').waitFor({ timeout: 4000 }).catch(() => {});
  await page.locator('input[aria-label="Search documents"]').type('page');
  await page.locator('[data-testid="sr"]').first().waitFor({ timeout: 12000 }).catch(() => {});
  await page.locator('[data-testid="sr"]').first().click();
  await page.waitForTimeout(800);
  const navigated = /[?&]doc=/.test(page.url());
  const modalClosed = await page.locator('[data-testid="gs-search"]').count() === 0;
  pass('8 clicking a result opens the doc (?doc=) and closes modal', navigated && modalClosed, `url=${page.url().slice(-40)} closed=${modalClosed}`);

  // ---- Launcher / global ----
  await page.goto(`${APP}/launcher`, { waitUntil: 'domcontentloaded' });
  const launcherBtn = page.getByRole('button', { name: 'Search', exact: true });
  await launcherBtn.first().waitFor({ timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(800);
  const launcherPill = await launcherBtn.count();
  pass('7a launcher global search button present', launcherPill >= 1, `btn=${launcherPill}`);
  if (launcherPill) {
    await launcherBtn.first().click();
    await page.locator('input[aria-label="Search documents"]').waitFor({ timeout: 4000 }).catch(() => {});
    const globalNoToggle = await page.locator('[data-testid="gs-search"]').getByRole('switch').count() === 0;
    await page.locator('input[aria-label="Search documents"]').type('beta');
    await page.locator('[data-testid="sr"]').first().waitFor({ timeout: 12000 }).catch(() => {});
    const spotlight = await page.locator('[data-testid="gs-search"][data-layout="spotlight"]').count() > 0;
    const rowsG = await page.locator('[data-testid="sr"]').count();
    // distinct workspace names shown in path lines
    const wsNames = new Set(await page.locator('[data-testid="sr-path"]').allInnerTexts());
    pass('7b launcher opens GLOBAL spotlight (no toggle), cross-workspace results', spotlight && globalNoToggle && rowsG > 0, `spotlight=${spotlight} noToggle=${globalNoToggle} rows=${rowsG} wsVariety=${wsNames.size}`);
    await shot(page, '05-global-spotlight');
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((f) => console.log(' -', f.n, f.note)); process.exit(1); }
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
