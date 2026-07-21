// Copy-to-Coda — scenario 54: kill-resume + transient rtc-unreachable resilience.
// Separate from the main suite because it restarts the backend mid-run.
// Requires the stack running with a SHORT lease so the crashed item is reclaimed quickly:
//   MIGRATION_LEASE_TTL_MS=15000 SKIP_DB_SETUP=1 pnpm dev:services
// Run:  NODE_PATH=<scratch>/node_modules node tests/copy-to-coda-kill-resume.playwright.cjs
const { chromium } = require("playwright");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const L = require("./copy-to-coda.lib.cjs");
const { sleep } = L;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"} ${m}`); c ? pass++ : fail++; };
const REPO = path.join(__dirname, "..");

function killStack() { try { execSync('for p in 4000 4001 4002 5173; do lsof -tnP -iTCP:$p -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done', { shell: "/bin/bash", stdio: "ignore" }); } catch {} }
function killBackendOnly() { try { execSync('lsof -tnP -iTCP:4000 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null', { shell: "/bin/bash", stdio: "ignore" }); } catch {} }
function startStack() {
  const out = fs.openSync("/tmp/tc-killresume-stack.log", "a");
  const child = spawn("pnpm", ["dev:services"], { cwd: REPO, env: { ...process.env, MIGRATION_LEASE_TTL_MS: "15000", SKIP_DB_SETUP: "1" }, detached: true, stdio: ["ignore", out, out] });
  child.unref();
}
async function waitReady(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${L.API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@toddle.test", password: "password123" }) });
      const rtc = await fetch("http://localhost:4001/health").then(() => true).catch(() => false);
      if (r.status === 201 && rtc) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

async function main() {
  fs.mkdirSync(L.ART, { recursive: true });
  const stamp = Date.now();
  console.log("=== 54 setup: fresh ws + wide tree + destination ===");
  const owner = await L.login();
  const ws = await L.createWorkspace(owner.accessToken, `e2e-kr-${stamp}`);
  let wsToken = (await L.enterWs(owner.accessToken, ws.id)).accessToken;
  const wsId = ws.id;
  const root = await L.createDoc(wsToken, wsId, "KR Root");
  const kids = [];
  for (const n of ["KR Alpha", "KR Bravo", "KR Charlie"]) kids.push(await L.createDoc(wsToken, wsId, n, root.id));
  const browser = await chromium.launch();
  for (const d of [root, ...kids]) await L.typeContent(browser, wsId, d.id, d.title);
  await browser.close();

  // Destination via the admin API (scenario 49 covers the UI add path); keeps this
  // scenario focused on kill-resume.
  const scope = await L.createScope(owner.accessToken, wsId, "KR Dest", L.CODA_DEST_URL, L.CODA_TOKEN);
  const scopeId = scope.id;

  const items = [
    { sourceDocId: root.id, plannedParentDocId: null, title: "KR Root", include: true },
    ...kids.map((k) => ({ sourceDocId: k.id, plannedParentDocId: root.id, title: k.name, include: true })),
  ];

  console.log("=== enqueue + KILL BACKEND mid-run ===");
  // Refresh the ws token — setup (content typing + UI dest-add) can outlast the access-token TTL.
  wsToken = (await L.enterWs((await L.login()).accessToken, wsId)).accessToken;
  const r = await L.enqueue(wsToken, scopeId, items, root.id);
  ok(r.status === 201, `enqueue 201 (${r.status})`);
  const jobId = r.data.jobId;
  // wait until root has a codaPageId (RUNNING) with children still pending, then kill backend
  let killedState = null;
  for (let i = 0; i < 120; i++) {
    const job = await L.getJob(wsToken, jobId).catch(() => null);
    if (!job) break;
    const withPage = job.items.filter((x) => x.codaPageId).length;
    const pendRun = job.items.filter((x) => ["PENDING", "RUNNING"].includes(x.status)).length;
    if (withPage >= 1 && pendRun >= 1) { killedState = job.items.map((x) => `${x.title}:${x.status}:${x.codaPageId || "-"}`); killBackendOnly(); break; }
    if (["SUCCEEDED", "FAILED", "PARTIAL"].includes(job.status)) break;
    await sleep(500);
  }
  ok(!!killedState, `killed backend mid-run (state: ${killedState})`);
  const rootCodaId = (await L.getJob(wsToken, jobId).catch(() => null)); // backend down now; ignore

  console.log("=== restart stack (short lease) ===");
  killStack();
  await sleep(3000);
  startStack();
  const ready = await waitReady();
  ok(ready, "stack restarted + rtc up");

  console.log("=== resume: poll to terminal ===");
  const wsToken2 = (await L.enterWs((await L.login()).accessToken, wsId)).accessToken;
  const job = await L.pollJob(wsToken2, jobId, { timeoutMs: 240000 });
  ok(job.status === "SUCCEEDED", `job resumed to SUCCEEDED (${job.status})`);
  ok(job.items.every((i) => i.status === "SUCCEEDED"), `all items SUCCEEDED, none permanently failed by transient rtc-unreachable (${job.items.map((i) => i.status).join(",")})`);
  ok(job.items.every((i) => i.attempts <= 1), `attempts not burned by transient errors (max attempts=${Math.max(...job.items.map((i) => i.attempts))})`);
  // no duplicate: exactly the 4 items' pages, each unique, root appears once
  const desc = await L.codaDescendants();
  const rootId = job.items.find((i) => i.sourceDocId === root.id).codaPageId;
  const rootCount = desc.filter((p) => p.id === rootId).length;
  const titles = desc.map((p) => p.name);
  ok(rootCount === 1, `no duplicate root page in Coda (count=${rootCount})`);
  ok(new Set(desc.map((p) => p.id)).size === desc.length, `no duplicate page ids`);
  // transient rtc-unreachable during the restart window did not permanently fail items (covered by all-SUCCEEDED + attempts<=1)
  console.log("=== cleanup ===");
  const remaining = await L.codaCleanupUnderRoot();
  console.log("remaining under scope root after cleanup:", remaining);
  console.log(`\n54 kill-resume: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("KR ERROR:", e); process.exit(1); });
