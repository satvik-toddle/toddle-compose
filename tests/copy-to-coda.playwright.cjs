// Copy-to-Coda — real UI + real Coda E2E matrix (docs/copy-to-coda-tests.md §8, items 49–55).
// Plain-node Playwright (NODE_PATH to a scratch playwright install). Drives the actual app
// against the real Coda test doc, uses a FRESH workspace + destination, and cleans up the
// Coda pages it creates under the scope root between/after runs.
//
// Run:  NODE_PATH=<scratch>/node_modules node tests/copy-to-coda.playwright.cjs
// Env:  TC_SCENARIOS=49,50,...  (default: all here; kill-resume=54 lives in the sibling script)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const L = require("./copy-to-coda.lib.cjs");
const { sleep } = L;

let pass = 0, fail = 0;
const lines = [];
const ok = (cond, msg) => { const s = cond ? "PASS" : "FAIL"; if (cond) pass++; else fail++; console.log(`  ${s} ${msg}`); lines.push(`${s} ${msg}`); return cond; };
const perPage = (u) => /^https:\/\/docs\.superhuman\.com\/d\/.+\/_su/.test(u || "");

async function main() {
  fs.mkdirSync(L.ART, { recursive: true });
  const only = process.env.TC_SCENARIOS ? new Set(process.env.TC_SCENARIOS.split(",")) : null;
  const run = (n) => !only || only.has(String(n));
  const stamp = Date.now();

  const CACHE = process.env.TC_FIXTURES || path.join(require("os").tmpdir(), "tc-coda-fixtures.json");
  const browser = await chromium.launch();
  const owner = await L.login();
  const myPages = []; // page ids this process created (id-scoped cleanup — safe under a shared root)
  let wsId, wsToken, scopeId = null, wsName = null, D = {}, cached = false;

  if (!process.env.TC_SETUP && fs.existsSync(CACHE)) {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    wsId = c.wsId; scopeId = c.scopeId || null; wsName = c.wsName;
    for (const [k, v] of Object.entries(c.D)) D[k] = { id: v };
    wsToken = (await L.enterWs(owner.accessToken, wsId)).accessToken;
    cached = true;
    console.log(`=== loaded fixtures cache: ws=${wsId} scope=${scopeId} ===`);
  } else {
    console.log("=== SETUP: fresh workspace + doc trees + content ===");
    wsName = `e2e-coda-${stamp}`;
    const ws = await L.createWorkspace(owner.accessToken, wsName);
    wsToken = (await L.enterWs(owner.accessToken, ws.id)).accessToken;
    wsId = ws.id;
    console.log(`  workspace: ${wsId}  (e2e-coda-${stamp})`);
    D.single = await L.createDoc(wsToken, wsId, "Single Root");
    D.chainRoot = await L.createDoc(wsToken, wsId, "Chain Root");
    D.chainChild = await L.createDoc(wsToken, wsId, "Chain Child", D.chainRoot.id);
    D.chainGrand = await L.createDoc(wsToken, wsId, "Chain Grandchild", D.chainChild.id);
    D.wideRoot = await L.createDoc(wsToken, wsId, "Wide Root");
    D.w1 = await L.createDoc(wsToken, wsId, "Wide A", D.wideRoot.id);
    D.w2 = await L.createDoc(wsToken, wsId, "Wide B", D.wideRoot.id);
    D.w3 = await L.createDoc(wsToken, wsId, "Wide C", D.wideRoot.id);
    D.mixRoot = await L.createDoc(wsToken, wsId, "Mixed Root");
    D.mA = await L.createDoc(wsToken, wsId, "Mixed Alpha", D.mixRoot.id);
    D.mB = await L.createDoc(wsToken, wsId, "Mixed Beta", D.mixRoot.id);
    D.mB1 = await L.createDoc(wsToken, wsId, "Mixed Grandchild", D.mB.id);
    D.mSheet = await L.createDoc(wsToken, wsId, "Mixed Sheet", D.mixRoot.id, "SHEET");
    D.emptyRoot = await L.createDoc(wsToken, wsId, "Empty-Test Root");
    D.emptyChild = await L.createDoc(wsToken, wsId, "Empty Child (no content)", D.emptyRoot.id);
    D.delRoot = await L.createDoc(wsToken, wsId, "Delete-Mid Root");
    D.dA = await L.createDoc(wsToken, wsId, "Del A", D.delRoot.id);
    D.dB = await L.createDoc(wsToken, wsId, "Del B", D.delRoot.id);
    D.dC = await L.createDoc(wsToken, wsId, "Del C", D.delRoot.id);
    D.pit = await L.createDoc(wsToken, wsId, "PIT Root");
    const toType = [
      [D.single.id, "Single Root"], [D.chainRoot.id, "Chain Root"], [D.chainChild.id, "Chain Child"], [D.chainGrand.id, "Chain Grandchild"],
      [D.wideRoot.id, "Wide Root"], [D.w1.id, "Wide A"], [D.w2.id, "Wide B"], [D.w3.id, "Wide C"],
      [D.mixRoot.id, "Mixed Root"], [D.mA.id, "Mixed Alpha"], [D.mB.id, "Mixed Beta"], [D.mB1.id, "Mixed Grandchild"],
      [D.emptyRoot.id, "Empty-Test Root"], [D.delRoot.id, "Delete-Mid Root"], [D.dA.id, "Del A"], [D.dB.id, "Del B"], [D.dC.id, "Del C"], [D.pit.id, "PIT Root"],
    ];
    // Fresh context per doc (reusing one context flakes the editor mount on the 2nd doc);
    // the lib's login throttle keeps this under the 10/min auth limit.
    for (const [id, label] of toType) { await L.typeContent(browser, wsId, id, label); process.stdout.write("."); }
    console.log("\n  content authored for", toType.length, "docs");
    fs.writeFileSync(CACHE, JSON.stringify({ wsId, wsName, scopeId: null, D: Object.fromEntries(Object.entries(D).map(([k, v]) => [k, v.id])) }));
    console.log("  wrote fixtures cache:", CACHE);
  }
  const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify({ wsId, wsName, scopeId, D: Object.fromEntries(Object.entries(D).map(([k, v]) => [k, v.id])) }));

  // ---- helper: run a migration via API, poll, assert reality ----
  async function migrate(rootDoc, items, { label, expectStatus = "SUCCEEDED" } = {}) {
    const r = await L.enqueue(wsToken, scopeId, items, rootDoc);
    if (r.status !== 201) return { enqErr: r };
    const job = await L.pollJob(wsToken, r.data.jobId, { onTick: () => {} });
    return { job, jobId: r.data.jobId };
  }
  // Assert every SUCCEEDED item has a real Coda page with correct parent, and no dup / no orphan pages.
  async function assertReality(job, items, label) {
    for (const it of job.items) if (it.codaPageId) myPages.push(it.codaPageId);
    const desc = await L.codaDescendants();
    const byDoc = new Map(job.items.map((i) => [i.sourceDocId, i]));
    const idToItem = new Map(job.items.map((i) => [i.codaPageId, i]));
    let good = true;
    for (const it of job.items) {
      if (it.status === "SUCCEEDED") {
        const page = desc.find((p) => p.id === it.codaPageId);
        if (!page) { good = false; console.log(`    [reality] MISSING page for SUCCEEDED "${it.title}" (${it.codaPageId})`); }
      } else {
        if (it.codaPageId && desc.find((p) => p.id === it.codaPageId)) { good = false; console.log(`    [reality] non-succeeded "${it.title}" has a live page`); }
      }
    }
    // No duplicate page ids among this job's items.
    const pids = job.items.filter((i) => i.codaPageId).map((i) => i.codaPageId);
    const dup = pids.length !== new Set(pids).size;
    ok(good && !dup, `${label}: status==reality (every SUCCEEDED has a live page; no orphan/dup)`);
    return desc;
  }
  function assertHierarchy(desc, expectPairs, label) {
    // expectPairs: [[childCodaId, parentCodaId|ROOT], ...]
    let good = true;
    for (const [child, parent] of expectPairs) {
      const p = desc.find((d) => d.id === child);
      if (!p || p.parent !== parent) { good = false; console.log(`    [hier] ${child} parent=${p?.parent} expected=${parent}`); }
    }
    ok(good, `${label}: correct Coda hierarchy`);
  }
  async function assertPerPageUrls(docIds, label) {
    const maps = await L.getMappings(wsToken, scopeId, docIds);
    const allPer = maps.length === docIds.length && maps.every((m) => perPage(m.codaPageUrl));
    ok(allPer, `${label}: mapping URLs are per-page (${maps.map((m) => m.codaPageUrl.split("/").pop()).join(", ")})`);
    return maps;
  }
  const codaIdOf = (job, docId) => job.items.find((i) => i.sourceDocId === docId)?.codaPageId;

  // ============================ SCENARIO 49 ============================
  // Runs whenever the scope doesn't exist yet (needed by every later scenario).
  if (!scopeId) {
    console.log("\n=== 49: Admin → add destination (+ masked hint + validation error) ===");
    const { ctx, page } = await L.openCtx(browser, wsId);
    await page.goto(`${L.APP}/admin/migrations`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('text=Add destination', { timeout: 30000 });
    // --- bad URL → validation error ---
    await page.locator('button:has-text("Add destination")').first().click();
    await page.waitForSelector('text=A Coda location migrations may write into', { timeout: 8000 });
    await page.locator('input[placeholder="e.g. Product wiki"]').fill("Bad Dest");
    let wc = page.locator('.m-body').locator('[class*="__control"]').first();
    await wc.click(); await sleep(300); await page.keyboard.type(wsName, { delay: 12 }); await sleep(600);
    await page.locator('[class*="__option"]', { hasText: wsName }).first().click(); await sleep(200);
    await page.locator('input[placeholder="https://coda.io/d/…"]').fill("https://coda.io/d/not-a-real-doc-zzz");
    await page.locator('input[placeholder="Paste a Coda API token"]').fill(L.CODA_TOKEN);
    await page.locator('.m-foot button:has-text("Add destination")').click();
    const badErr = await page.locator('.m-body [class*="lert"], .m-body [role="alert"]').first().innerText({ timeout: 12000 }).catch(() => "");
    ok(/could not|invalid|resolve|Coda URL|not a valid/i.test(badErr), `bad/out-of-scope URL surfaces a validation error ("${badErr.slice(0, 60)}")`);
    await page.screenshot({ path: path.join(L.ART, "49a-validation-error.png") });
    // Close and open a FRESH modal for the valid submit (avoids in-place refill flakiness).
    await page.locator('.m-foot button:has-text("Cancel")').click().catch(() => {});
    await sleep(500);
    await page.locator('button:has-text("Add destination")').first().click();
    await page.waitForSelector('text=A Coda location migrations may write into', { timeout: 8000 });
    await page.locator('input[placeholder="e.g. Product wiki"]').fill("Bad Dest");
    wc = page.locator('.m-body').locator('[class*="__control"]').first();
    await wc.click(); await sleep(300); await page.keyboard.type(wsName, { delay: 12 }); await sleep(600);
    await page.locator('[class*="__option"]', { hasText: wsName }).first().click(); await sleep(200);
    await page.locator('input[placeholder="https://coda.io/d/…"]').fill(L.CODA_DEST_URL);
    await page.locator('input[placeholder="Paste a Coda API token"]').fill(L.CODA_TOKEN);
    await page.locator('.m-foot button:has-text("Add destination")').click();
    const added = await page.locator('text=Destination added').isVisible({ timeout: 15000 }).catch(() => false);
    ok(added, "valid destination added (toast 'Destination added')");
    await page.screenshot({ path: path.join(L.ART, "49b-added.png") });
    await ctx.close();
  }
  // Resolve the scope id (created above, or find existing on this ws) + cache it.
  {
    const scopes = await L.must("/migration-scopes", { token: owner.accessToken });
    const s = scopes.find((x) => x.workspaceId === wsId && x.label === "Bad Dest") || scopes.find((x) => x.workspaceId === wsId);
    if (s) {
      scopeId = s.id;
      ok(Array.isArray(s.tokens) && s.tokens.length >= 1 && s.tokens.every((t) => !t.token && (t.hint || t.last4)), `token stored masked (hint only), scope=${scopeId}`);
      saveCache();
    }
  }
  if (!scopeId) { console.log("no scope — aborting"); await browser.close(); process.exit(1); }

  // ============================ SCENARIO 50 ============================
  if (run(50)) {
    console.log("\n=== 50: Copy-to-Coda modal (tree, SHEET filter, drag, mode gating, no layout shift, icons) ===");
    const { ctx, page } = await L.openCtx(browser, wsId);
    await page.goto(`${L.APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(D.mixRoot.id)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(L.EDITOR, { timeout: 30000 }); await sleep(1500);
    await page.locator('[aria-label="Page actions"]').last().click();
    await page.locator('text=Copy to Coda').last().click();
    await page.waitForSelector('text=Review pages', { timeout: 8000 }); await sleep(1200);
    const modal = page.locator('[role="dialog"]').first();
    const mText = await modal.innerText();
    ok(/Mixed Root/.test(mText) && /Mixed Alpha/.test(mText) && /Mixed Beta/.test(mText) && /Mixed Grandchild/.test(mText), "tree renders all 4 DOCs incl. grandchild");
    ok(!/Mixed Sheet/.test(mText) && /sheet(s)? skipped/.test(mText), "SHEET filtered ('N sheets skipped')");
    ok((await page.locator('[aria-label^="Reorder "]').count()) === 4, "DotsSixVertical drag handles present");
    // select destination
    const dc = page.locator('text=Destination').locator('xpath=following::*[contains(@class,"__control")][1]');
    await dc.click(); await sleep(400); await page.locator('[class*="__option"]').first().click(); await sleep(600);
    // mode gating: default Create → link affordance present in DOM but HIDDEN (no layout shift);
    // Update → visible. Assert on VISIBILITY (the slot toggles visibility, not presence).
    const linksCreate = await page.locator('[aria-label="Set destination link"]:visible, [aria-label="Edit destination link"]:visible').count();
    // Measure a row height in create mode (layout-shift check).
    const rowSel = '[aria-label^="Reorder "]';
    const hCreate = await page.locator(rowSel).first().evaluate((el) => el.closest('[data-rbd-draggable-id], li, div')?.getBoundingClientRect().height || 0).catch(() => 0);
    await page.screenshot({ path: path.join(L.ART, "50a-create-mode.png") });
    // switch to Update existing → links appear
    await page.locator('[role="dialog"] >> text=Update existing').click().catch(async () => await page.locator('text=Update existing').click());
    await sleep(800);
    const linksUpdate = await page.locator('[aria-label="Set destination link"]:visible, [aria-label="Edit destination link"]:visible').count();
    const hUpdate = await page.locator(rowSel).first().evaluate((el) => el.closest('[data-rbd-draggable-id], li, div')?.getBoundingClientRect().height || 0).catch(() => 0);
    ok(linksCreate === 0 && linksUpdate === 4, `mode gating: Create hides links (=${linksCreate}) / Update shows links (=${linksUpdate})`);
    ok(Math.abs(hCreate - hUpdate) <= 2, `no row-height layout shift between modes (${hCreate}px vs ${hUpdate}px)`);
    await page.screenshot({ path: path.join(L.ART, "50b-update-mode.png") });
    await ctx.close();
  }

  // ============================ SCENARIO 51 (UI Start → icons) + 52 (mixed nested one-pass) ============
  if (run(51) || run(52)) {
    console.log("\n=== 51/52: UI Start Copy (mixed nested) → toast → nav → QUEUED→RUNNING→SUCCEEDED icons; real hierarchy + per-page URLs ===");
    const { ctx, page } = await L.openCtx(browser, wsId);
    let toastSeen = false;
    page.locator('text=Migration started').waitFor({ timeout: 12000 }).then(() => { toastSeen = true; }).catch(() => {});
    await page.goto(`${L.APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(D.mixRoot.id)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(L.EDITOR, { timeout: 30000 }); await sleep(1500);
    await page.locator('[aria-label="Page actions"]').last().click();
    await page.locator('text=Copy to Coda').last().click();
    await page.waitForSelector('text=Review pages', { timeout: 8000 }); await sleep(1000);
    const dc = page.locator('text=Destination').locator('xpath=following::*[contains(@class,"__control")][1]');
    await dc.click(); await sleep(400); await page.locator('[class*="__option"]').first().click(); await sleep(500);
    await page.getByRole('button', { name: 'Start Copy' }).click();
    await page.waitForURL(/\/w\/.*\/migrations/, { timeout: 15000 }).catch(() => {});
    ok(toastSeen, "51: success toast 'Migration started'");
    ok(/\/migrations/.test(page.url()), "51: auto-nav to /w/:id/migrations");
    // jobId from the API (robust to the toast/nav race).
    await sleep(1500);
    const jrows = (await L.must(`/migration-jobs?workspaceId=${wsId}`, { token: wsToken })).filter((j) => j.sourceRootDocId === D.mixRoot.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const jobId = jrows.length ? jrows[jrows.length - 1].id : null;
    ok(!!jobId, `51: Start Copy created a migration job (${jobId})`);
    // status shown as ICON on the migrations page (role="img" + status aria-label).
    let iconLabels = [];
    for (let i = 0; i < 12; i++) { iconLabels = await page.locator('[role="img"][aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))); if (iconLabels.some((l) => ["Queued", "Running", "Succeeded", "Partial", "Pending"].includes(l))) break; await sleep(1500); }
    ok(iconLabels.some((l) => ["Queued", "Running", "Succeeded", "Partial", "Pending"].includes(l)), `51: run status shown as ICON (${[...new Set(iconLabels)].join(",")})`);
    await page.screenshot({ path: path.join(L.ART, "51a-migrations-icons.png"), fullPage: true });
    // poll to terminal
    const job = await L.pollJob(wsToken, jobId);
    ok(job.status === "SUCCEEDED", `51/52: job SUCCEEDED (${job.status})`);
    ok(job.items.every((i) => i.status === "SUCCEEDED"), `51: no created-but-FAILED / no false-green (items: ${job.items.map((i) => i.status).join(",")})`);
    const desc = await assertReality(job, null, "52-mixed");
    assertHierarchy(desc, [
      [codaIdOf(job, D.mixRoot.id), L.CODA_ROOT_PAGE],
      [codaIdOf(job, D.mA.id), codaIdOf(job, D.mixRoot.id)],
      [codaIdOf(job, D.mB.id), codaIdOf(job, D.mixRoot.id)],
      [codaIdOf(job, D.mB1.id), codaIdOf(job, D.mB.id)],
    ], "52-mixed");
    await assertPerPageUrls([D.mixRoot.id, D.mA.id, D.mB.id, D.mB1.id], "52-mixed");
    await ctx.close();

    // ---------- 53: override re-run (Update mode), zero duplicates ----------
    if (run(53)) {
      console.log("\n=== 53: override re-run (Update mode, prefilled links) → replace in place, ZERO dup ===");
      const beforeIds = job.items.filter((i) => i.codaPageId).map((i) => i.codaPageId).sort();
      const { ctx: c2, page: p2 } = await L.openCtx(browser, wsId);
      await p2.goto(`${L.APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(D.mixRoot.id)}`, { waitUntil: "domcontentloaded" });
      await p2.waitForSelector(L.EDITOR, { timeout: 30000 }); await sleep(1500);
      await p2.locator('[aria-label="Page actions"]').last().click();
      await p2.locator('text=Copy to Coda').last().click();
      await p2.waitForSelector('text=Review pages', { timeout: 8000 }); await sleep(1000);
      const dc2 = p2.locator('text=Destination').locator('xpath=following::*[contains(@class,"__control")][1]');
      await dc2.click(); await sleep(400); await p2.locator('[class*="__option"]').first().click(); await sleep(800);
      await p2.locator('[role="dialog"] >> text=Update existing').click(); await sleep(1800);
      const editLinks = await p2.locator('[aria-label="Edit destination link"]:visible').count();
      const urls = await p2.locator('[role="dialog"] [title^="https://"]').evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      ok(editLinks === 4 && urls.length === 4 && urls.every(perPage), `53: 4 rows prefilled with per-page links`);
      await p2.screenshot({ path: path.join(L.ART, "53a-override-prefill.png") });
      await p2.getByRole('button', { name: 'Start Copy' }).click();
      await p2.waitForURL(/\/migrations/, { timeout: 15000 }).catch(() => {});
      await sleep(2000);
      const orows = (await L.must(`/migration-jobs?workspaceId=${wsId}`, { token: wsToken })).filter((j) => j.sourceRootDocId === D.mixRoot.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const ojob = await L.pollJob(wsToken, orows[orows.length - 1].id);
      for (const it of ojob.items) if (it.codaPageId) myPages.push(it.codaPageId);
      const afterIds = ojob.items.filter((i) => i.codaPageId).map((i) => i.codaPageId).sort();
      const descAfter = await L.codaDescendants();
      const myLive = descAfter.filter((p) => afterIds.includes(p.id)).length;
      ok(ojob.status === "SUCCEEDED" && ojob.items.every((i) => i.override && i.status === "SUCCEEDED"), `53: override job SUCCEEDED, all override=true (${ojob.status})`);
      ok(JSON.stringify(beforeIds) === JSON.stringify(afterIds), `53: same codaPageIds — no new pages`);
      ok(myLive === afterIds.length && afterIds.length === beforeIds.length, `53: exactly ${afterIds.length} live pages for my tree — ZERO duplicates`);
      await c2.close();
    }
    console.log("  cleanup mixed tree pages...");
    await L.codaCleanupIds([...new Set(myPages.splice(0))]);
    await sleep(10000); // let the Coda write bucket drain before the next matrix run
  }

  // ============================ SCENARIO 52 matrix: single / chain / wide (API-enqueued) ============
  const shapes = [
    run(52) && { key: "single", root: D.single.id, items: [{ sourceDocId: D.single.id, plannedParentDocId: null, title: "Single Root", include: true }], hier: (j) => [[codaIdOf(j, D.single.id), L.CODA_ROOT_PAGE]], docIds: [D.single.id] },
    run(52) && { key: "chain", root: D.chainRoot.id, items: [
      { sourceDocId: D.chainRoot.id, plannedParentDocId: null, title: "Chain Root", include: true },
      { sourceDocId: D.chainChild.id, plannedParentDocId: D.chainRoot.id, title: "Chain Child", include: true },
      { sourceDocId: D.chainGrand.id, plannedParentDocId: D.chainChild.id, title: "Chain Grandchild", include: true },
    ], hier: (j) => [[codaIdOf(j, D.chainRoot.id), L.CODA_ROOT_PAGE], [codaIdOf(j, D.chainChild.id), codaIdOf(j, D.chainRoot.id)], [codaIdOf(j, D.chainGrand.id), codaIdOf(j, D.chainChild.id)]], docIds: [D.chainRoot.id, D.chainChild.id, D.chainGrand.id] },
    run(52) && { key: "wide", root: D.wideRoot.id, items: [
      { sourceDocId: D.wideRoot.id, plannedParentDocId: null, title: "Wide Root", include: true },
      { sourceDocId: D.w1.id, plannedParentDocId: D.wideRoot.id, title: "Wide A", include: true },
      { sourceDocId: D.w2.id, plannedParentDocId: D.wideRoot.id, title: "Wide B", include: true },
      { sourceDocId: D.w3.id, plannedParentDocId: D.wideRoot.id, title: "Wide C", include: true },
    ], hier: (j) => [[codaIdOf(j, D.wideRoot.id), L.CODA_ROOT_PAGE], [codaIdOf(j, D.w1.id), codaIdOf(j, D.wideRoot.id)], [codaIdOf(j, D.w2.id), codaIdOf(j, D.wideRoot.id)], [codaIdOf(j, D.w3.id), codaIdOf(j, D.wideRoot.id)]], docIds: [D.wideRoot.id, D.w1.id, D.w2.id, D.w3.id] },
  ].filter(Boolean);
  for (const sh of shapes) {
    console.log(`\n=== 52 [${sh.key}]: create-mode migration → one-pass SUCCEEDED + hierarchy + per-page URLs ===`);
    const r = await L.enqueue(wsToken, scopeId, sh.items, sh.root);
    if (!ok(r.status === 201, `52[${sh.key}]: enqueue 201`)) continue;
    const job = await L.pollJob(wsToken, r.data.jobId);
    ok(job.status === "SUCCEEDED" && job.items.every((i) => i.status === "SUCCEEDED"), `52[${sh.key}]: all items SUCCEEDED in one pass (${job.items.map((i) => i.status).join(",")})`);
    const desc = await assertReality(job, null, `52[${sh.key}]`);
    assertHierarchy(desc, sh.hier(job), `52[${sh.key}]`);
    await assertPerPageUrls(sh.docIds, `52[${sh.key}]`);
    await L.codaCleanupIds([...new Set(myPages.splice(0))]);
    await sleep(10000);
  }

  // ============================ empty-source skip (clean, no false-green→ still SUCCEEDED) ============
  if (run("empty")) {
    console.log("\n=== extra: empty-source child → clean SKIP (job stays SUCCEEDED, status==reality) ===");
    const items = [
      { sourceDocId: D.emptyRoot.id, plannedParentDocId: null, title: "Empty-Test Root", include: true },
      { sourceDocId: D.emptyChild.id, plannedParentDocId: D.emptyRoot.id, title: "Empty Child (no content)", include: true },
    ];
    const r = await L.enqueue(wsToken, scopeId, items, D.emptyRoot.id);
    const job = await L.pollJob(wsToken, r.data.jobId);
    const rootIt = job.items.find((i) => i.sourceDocId === D.emptyRoot.id);
    const childIt = job.items.find((i) => i.sourceDocId === D.emptyChild.id);
    ok(job.status === "SUCCEEDED", `empty-skip: job SUCCEEDED (empty skip is clean) (${job.status})`);
    ok(rootIt.status === "SUCCEEDED" && childIt.status === "SKIPPED", `empty-skip: root SUCCEEDED, empty child SKIPPED (${childIt.status})`);
    await assertReality(job, null, "empty-skip");
    await L.codaCleanupIds([...new Set(myPages.splice(0))]);
    await sleep(10000);
  }

  // ============================ delete-source-mid-run → tainting SKIP → PARTIAL (no false-green) ============
  if (run("del")) {
    console.log("\n=== extra: delete-source-mid-run → source-deleted SKIP taints → job PARTIAL (never false-green) ===");
    const items = [
      { sourceDocId: D.delRoot.id, plannedParentDocId: null, title: "Delete-Mid Root", include: true },
      { sourceDocId: D.dA.id, plannedParentDocId: D.delRoot.id, title: "Del A", include: true },
      { sourceDocId: D.dB.id, plannedParentDocId: D.delRoot.id, title: "Del B", include: true },
      { sourceDocId: D.dC.id, plannedParentDocId: D.delRoot.id, title: "Del C", include: true },
    ];
    const r = await L.enqueue(wsToken, scopeId, items, D.delRoot.id);
    // delete Del B right away (before the worker reaches the children)
    await L.api(`/documents/${D.dB.id}`, { method: "DELETE", token: wsToken });
    const job = await L.pollJob(wsToken, r.data.jobId);
    const dbIt = job.items.find((i) => i.sourceDocId === D.dB.id);
    ok(dbIt.status === "SKIPPED", `delete-mid: deleted source SKIPPED (${dbIt.status})`);
    ok(job.status === "PARTIAL", `delete-mid: job PARTIAL — tainting skip, NOT false-green (${job.status})`);
    await assertReality(job, null, "delete-mid");
    await L.codaCleanupIds([...new Set(myPages.splice(0))]);
    await sleep(10000);
  }

  // ============================ SCENARIO 55: point-in-time ============================
  if (run(55)) {
    console.log("\n=== 55: point-in-time — edit AFTER Start Copy → migration pushes the QUEUED version ===");
    const headBefore = await L.getHeadSeq(D.pit.id);
    const r = await L.enqueue(wsToken, scopeId, [{ sourceDocId: D.pit.id, plannedParentDocId: null, title: "PIT Root", include: true }], D.pit.id);
    ok(r.status === 201, "55: enqueue 201 (freezes snapshot at head " + headBefore + ")");
    // Immediately edit the doc AFTER enqueue.
    const marker = `EDITED-AFTER-START-${Date.now()}`;
    await L.appendMarker(browser, wsId, D.pit.id, marker);
    const headAfter = await L.getHeadSeq(D.pit.id);
    ok(headAfter > headBefore, `55: doc edited after Start Copy (head ${headBefore}→${headAfter})`);
    const job = await L.pollJob(wsToken, r.data.jobId);
    const it = job.items[0];
    ok(job.status === "SUCCEEDED", `55: job SUCCEEDED (${job.status})`);
    ok(it.migratedSeq === headBefore, `55: pushed==queued — migratedSeq(${it.migratedSeq}) == enqueue head(${headBefore}), NOT ${headAfter}`);
    await assertReality(job, null, "55-pit");
    await L.codaCleanupIds([...new Set(myPages.splice(0))]);
    await sleep(8000);
  }

  await browser.close();
  console.log(`\n================ RESULT: ${pass} passed, ${fail} failed ================`);
  fs.writeFileSync(path.join(L.ART, "suite-results.txt"), lines.join("\n") + `\n\n${pass} passed, ${fail} failed\n`);
  // Final safety cleanup.
  const remaining = await L.codaCleanupIds([...new Set(myPages.splice(0))]);
  console.log("final Coda cleanup — remaining descendants under scope root:", remaining);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SUITE ERROR:", e); process.exit(1); });
