// Shared helpers for the Copy-to-Coda real-UI + real-Coda E2E suite.
// Plain-node (no @playwright/test). See copy-to-coda.playwright.cjs for the driver.
const fs = require("fs");
const path = require("path");

const API = "http://localhost:4000/api";
const APP = "http://localhost:5173";
const EDITOR = ".ds-de-contentEditable";
const PW = "password123";
const ART = path.join(__dirname, "artifacts", "copy-to-coda");
const CODA_BASE = "https://coda.io/apis/v1";

function envVal(name) {
  const line = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n").find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "").trim() : "";
}
const CODA_TOKEN = process.env.CODA_API_TOKEN || envVal("CODA_API_TOKEN");
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || envVal("INTERNAL_TOKEN");
// The shared real Coda test doc + page-root (see docs/copy-to-coda-tests.md).
const CODA_DEST_URL = "https://docs.superhuman.com/d/Dev-research-doc-5A_dYrsGSKG-tN/TC-Migration-Test_suUsto88";
const CODA_DOC_ID = "YrsGSKG-tN";
const CODA_ROOT_PAGE = "canvas-WTgEUsto88";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Backend REST ----
async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const must = async (p, opts) => {
  const r = await api(p, opts);
  if (r.status >= 400) throw new Error(`${opts?.method || "GET"} ${p} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
// Login is rate-limited (10/min/IP). Throttle to <=8 per rolling 60s so a suite
// that opens many browser contexts never trips a 429.
const _loginTimes = [];
async function login(email = "owner@toddle.test") {
  for (;;) {
    const now = Date.now();
    while (_loginTimes.length && now - _loginTimes[0] > 60000) _loginTimes.shift();
    if (_loginTimes.length < 6) { _loginTimes.push(now); break; }
    await sleep(2000);
  }
  return must("/auth/login", { method: "POST", body: { email, password: PW } });
}

// ---- rtc internal (head-seq for point-in-time) ----
async function getHeadSeq(docId) {
  const r = await fetch(`http://localhost:4001/internal/docs/${encodeURIComponent(docId)}/head-seq`, { headers: { "X-Internal-Token": INTERNAL_TOKEN } });
  const j = await r.json();
  return j.headSeq;
}
async function getCodaHtmlMeta(docId) {
  const r = await fetch(`http://localhost:4001/internal/docs/${encodeURIComponent(docId)}/coda-html`, { headers: { "X-Internal-Token": INTERNAL_TOKEN } });
  return r.json();
}

// ---- Coda REST (read freely; WRITES are rate-limited to <=5 / 10s) ----
const _writeTimes = [];
async function _codaWriteGate() {
  for (;;) {
    const now = Date.now();
    while (_writeTimes.length && now - _writeTimes[0] > 11000) _writeTimes.shift();
    if (_writeTimes.length < 4) { _writeTimes.push(now); return; }
    await sleep(1500);
  }
}
async function codaGet(p) {
  const r = await fetch(`${CODA_BASE}${p}`, { headers: { Authorization: `Bearer ${CODA_TOKEN}` } });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function codaListAllPages() {
  const out = []; let token = null;
  do {
    const q = token ? `?pageToken=${encodeURIComponent(token)}` : "?limit=100";
    const { data } = await codaGet(`/docs/${CODA_DOC_ID}/pages${q}`);
    out.push(...(data.items || [])); token = data.nextPageToken || null;
  } while (token);
  return out;
}
// Descendants (recursive) of a root page id.
async function codaDescendants(rootPage = CODA_ROOT_PAGE) {
  const pages = await codaListAllPages();
  const byId = new Map(pages.map((p) => [p.id, p]));
  const parentOf = (p) => p.parent?.id || null;
  const isDesc = (p) => { let c = p, g = 0; while (c && g++ < 50) { const par = parentOf(c); if (par === rootPage) return true; c = par ? byId.get(par) : null; } return false; };
  return pages.filter(isDesc).map((p) => ({ id: p.id, name: p.name, parent: parentOf(p), browserLink: p.browserLink }));
}
async function codaDeletePage(pageId) {
  await _codaWriteGate();
  const r = await fetch(`${CODA_BASE}/docs/${CODA_DOC_ID}/pages/${pageId}`, { method: "DELETE", headers: { Authorization: `Bearer ${CODA_TOKEN}` } });
  return r.status;
}
// Delete every descendant of the scope root (cleanup). Deletes roots first (cascades), retries leftovers.
async function codaCleanupUnderRoot(rootPage = CODA_ROOT_PAGE) {
  let desc = await codaDescendants(rootPage);
  const seen = new Set();
  for (const p of desc) { if (!seen.has(p.id)) { seen.add(p.id); await codaDeletePage(p.id); } }
  await sleep(4000);
  desc = await codaDescendants(rootPage);
  return desc.length; // remaining (should trend to 0)
}
// Delete a specific set of page ids (my run's pages only — safe under a shared root).
async function codaCleanupIds(ids) {
  for (const id of ids) { if (id) await codaDeletePage(id); }
  await sleep(3000);
}

async function codaGetPageContentText(pageId) {
  // Export page content as plaintext-ish via the pages content endpoint (best-effort).
  const { status, data } = await codaGet(`/docs/${CODA_DOC_ID}/pages/${pageId}`);
  return { status, name: data?.name, browserLink: data?.browserLink };
}

// ---- migration API ----
async function enqueue(token, scopeId, items, sourceRootDocId) {
  return api(`/migration-scopes/${scopeId}/jobs`, { method: "POST", token, body: { items, sourceRootDocId } });
}
async function getJob(token, jobId) { return must(`/migration-jobs/${jobId}`, { token }); }
async function pollJob(token, jobId, { timeoutMs = 240000, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const job = await getJob(token, jobId);
    if (onTick) onTick(job);
    if (["SUCCEEDED", "FAILED", "PARTIAL", "CANCELED"].includes(job.status)) return job;
    if (Date.now() - t0 > timeoutMs) return { ...job, _timeout: true };
    await sleep(3000);
  }
}
async function getMappings(token, scopeId, docIds) {
  return must(`/migration-scopes/${scopeId}/mappings?docIds=${docIds.join(",")}`, { token });
}

// ---- fixtures ----
async function createWorkspace(ownerToken, name) {
  return must("/workspaces", { method: "POST", token: ownerToken, body: { name, visibility: "PRIVATE", defaultRole: "READ" } });
}
async function enterWs(ownerToken, wsId) { return must("/auth/workspace/enter", { method: "POST", token: ownerToken, body: { workspaceId: wsId } }); }
// Create a destination scope via the same admin API the UI calls (scenario 49 covers the UI path).
async function createScope(ownerToken, wsId, label, codaUrl, token) {
  return must("/migration-scopes", { method: "POST", token: ownerToken, body: { workspaceId: wsId, label, codaUrl, tokens: [{ token }] } });
}
async function createDoc(wsToken, wsId, title, parentId, type) {
  return must("/documents", { method: "POST", token: wsToken, body: { title, workspaceId: wsId, ...(parentId ? { parentId } : {}), ...(type ? { type } : {}) } });
}

// Seed a fresh auth'd browser context (fresh login each call — refresh tokens rotate).
async function openCtx(browser, wsId) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const fresh = await login();
  await ctx.addInitScript(({ r, w }) => localStorage.setItem("tc-auth", JSON.stringify({ state: { refreshToken: r, lastActiveWorkspaceId: w }, version: 0 })), { r: fresh.refreshToken, w: wsId });
  const page = await ctx.newPage();
  page.on("pageerror", () => {});
  return { ctx, page };
}

// Type real content into a doc via the editor (own context; reliable).
async function typeContent(browser, wsId, docId, label) {
  const { ctx, page } = await openCtx(browser, wsId);
  await page.goto(`${APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(docId)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(1200);
  await page.locator(EDITOR).click();
  await sleep(300);
  await page.keyboard.press("Control+End").catch(() => {});
  await page.keyboard.type(`${label} overview. Real content for the Copy-to-Coda E2E. `, { delay: 4 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Details for ${label} so the exported HTML is non-empty.`, { delay: 4 });
  await sleep(1800);
  await ctx.close();
}
// Type content into many docs reusing ONE context (one login). Navigates doc-to-doc;
// if the editor doesn't mount (SPA re-nav flake), reloads once before failing.
async function typeContentBatch(browser, wsId, docs) {
  const { ctx, page } = await openCtx(browser, wsId);
  for (const [docId, label] of docs) {
    const url = `${APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(docId)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let up = await page.waitForSelector(EDITOR, { timeout: 20000 }).then(() => true).catch(() => false);
    if (!up) { await page.reload({ waitUntil: "domcontentloaded" }); up = await page.waitForSelector(EDITOR, { timeout: 30000 }).then(() => true).catch(() => false); }
    if (!up) throw new Error("editor never mounted for " + label);
    await sleep(1100);
    await page.locator(EDITOR).click();
    await sleep(250);
    await page.keyboard.press("Control+End").catch(() => {});
    await page.keyboard.type(`${label} overview. Real content for the Copy-to-Coda E2E. `, { delay: 4 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Details for ${label} so the exported HTML is non-empty.`, { delay: 4 });
    await sleep(1700);
    process.stdout.write(".");
  }
  await ctx.close();
}

async function appendMarker(browser, wsId, docId, marker) {
  const { ctx, page } = await openCtx(browser, wsId);
  await page.goto(`${APP}/w/${encodeURIComponent(wsId)}?doc=${encodeURIComponent(docId)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(1000);
  await page.locator(EDITOR).click();
  await page.keyboard.press("Control+End").catch(() => {});
  await page.keyboard.type(` ${marker}`, { delay: 6 });
  await sleep(1800);
  await ctx.close();
}

module.exports = {
  API, APP, EDITOR, ART, PW, CODA_TOKEN, INTERNAL_TOKEN, CODA_DEST_URL, CODA_DOC_ID, CODA_ROOT_PAGE,
  sleep, api, must, login, getHeadSeq, getCodaHtmlMeta,
  codaGet, codaListAllPages, codaDescendants, codaDeletePage, codaCleanupUnderRoot, codaCleanupIds, codaGetPageContentText,
  typeContentBatch,
  enqueue, getJob, pollJob, getMappings, createWorkspace, enterWs, createScope, createDoc, openCtx, typeContent, appendMarker,
};
