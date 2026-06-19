#!/usr/bin/env node
// 1000+ scenario benchmark for the ai-doc skill. Exercises every structure and
// content operation against the live stack, verifies each result, aggregates
// per-category accuracy, and (by default) deletes the docs it created.
//
//   node benchmark.cjs [--count N] [--keep] [--concurrency K]
//
// Needs backend:4000 + rtc:4001 up and an EDIT-scoped access token.

const API = process.env.COMPOSE_API_URL ?? "http://localhost:4000";
const RTC = process.env.COMPOSE_RTC_URL ?? "http://localhost:4001";
const TOKEN = process.env.COMPOSE_TOKEN ?? "ctk_Kv4wq9hj8e2qQv4mjuTW-S0fzKx_4sBdiOc6Z9CHi38";
const INTERNAL = process.env.INTERNAL_TOKEN ?? "dev-internal-secret-change-me";
const WORKSPACE = process.env.WS_ID ?? "cmqjgskux000dp641e23ar8sp";

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const COUNT = parseInt(getArg("--count", "1050"), 10);
const CONCURRENCY = parseInt(getArg("--concurrency", "10"), 10);
const KEEP = argv.includes("--keep");

// ---- HTTP helpers (with retry on transient network errors) -----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      await sleep(150 * (i + 1)); // brief backoff; covers a momentary restart
    }
  }
  throw lastErr;
}
async function api(method, p, body) {
  const res = await fetchRetry(`${API}/api${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const rtcTokens = new Map();
async function rtcToken(docId) {
  if (rtcTokens.has(docId)) return rtcTokens.get(docId);
  const r = await api("POST", `/documents/${docId}/rtc-token`);
  const tok = r.body.token;
  rtcTokens.set(docId, tok);
  return tok;
}
async function editDoc(docId, ops) {
  const token = await rtcToken(docId);
  const res = await fetchRetry(`${RTC}/docs/${docId}/edit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function readbackOnce(docId) {
  const v = await (await fetchRetry(`${RTC}/internal/docs/${docId}/versions`, { headers: { "X-Internal-Token": INTERNAL } })).json();
  if (!v.head) return { plainText: "", lexicalJson: "" };
  const s = await (await fetchRetry(`${RTC}/internal/docs/${docId}/versions/${v.head}`, { headers: { "X-Internal-Token": INTERNAL } })).json();
  return { plainText: s.plainText ?? "", lexicalJson: s.lexicalJson ?? "" };
}
// Persist (coalesce+flush) and extraction (worker pool) are async, so a fresh
// edit's content lands in the version snapshot a beat later — and more so under
// load. Poll up to ~4.5s for `expect` to appear before declaring it missing.
async function readbackUntil(docId, expect) {
  let last = { plainText: "", lexicalJson: "" };
  for (let i = 0; i < 15; i++) {
    last = await readbackOnce(docId);
    const hay = last.lexicalJson + "\n" + last.plainText;
    if (expect.every((s) => hay.includes(s))) return last;
    await sleep(300);
  }
  return last;
}

const created = new Set();
async function makeDoc(title, parentId) {
  const body = { title, workspaceId: WORKSPACE };
  if (parentId) body.parentId = parentId;
  const r = await api("POST", "/documents", body);
  if (r.status === 201 && r.body.id) created.add(r.body.id);
  return r;
}

// ---- scenario catalog ------------------------------------------------------
// Each generator returns {category, run: async (i) => ({ok, detail})}.
let SEQ = 0;
const uniq = (p) => `${p}-${Date.now().toString(36)}-${SEQ++}`;

const STRUCTURE = {
  "create-doc": async () => {
    const t = uniq("create"); const r = await makeDoc(t);
    if (r.status !== 201) return { ok: false, detail: `create status ${r.status}` };
    const g = await api("GET", `/documents/${r.body.id}`);
    return { ok: g.status === 200 && g.body.title === t, detail: g.body.title };
  },
  "create-nested": async () => {
    const parent = await makeDoc(uniq("parent"));
    if (parent.status !== 201) return { ok: false, detail: "parent create failed" };
    const child = await makeDoc(uniq("child"), parent.body.id);
    if (child.status !== 201) return { ok: false, detail: `child status ${child.status}` };
    const g = await api("GET", `/documents/${child.body.id}`);
    return { ok: g.body.parentId === parent.body.id, detail: `parentId=${g.body.parentId}` };
  },
  "rename": async () => {
    const r = await makeDoc(uniq("toRename")); const nt = uniq("renamed");
    const p = await api("PATCH", `/documents/${r.body.id}`, { title: nt });
    const g = await api("GET", `/documents/${r.body.id}`);
    return { ok: p.status === 200 && g.body.title === nt, detail: g.body.title };
  },
  "move": async () => {
    const a = await makeDoc(uniq("moveParent"));
    const b = await makeDoc(uniq("moveChild"));
    const p = await api("PATCH", `/documents/${b.body.id}/move`, { parentId: a.body.id });
    const g = await api("GET", `/documents/${b.body.id}`);
    return { ok: p.status === 200 && g.body.parentId === a.body.id, detail: `parentId=${g.body.parentId}` };
  },
  "visibility": async () => {
    // Backend allows PUBLIC / PRIVATE (WORKSPACE is a Prisma value but not a
    // valid API input). Toggle to PUBLIC and back to verify the round-trip.
    const r = await makeDoc(uniq("vis"));
    const p = await api("PATCH", `/documents/${r.body.id}/visibility`, { visibility: "PUBLIC" });
    const g = await api("GET", `/documents/${r.body.id}`);
    return { ok: p.status === 200 && g.body.visibility === "PUBLIC", detail: `status=${p.status} vis=${g.body.visibility}` };
  },
  "delete": async () => {
    const r = await makeDoc(uniq("toDelete"));
    const d = await api("DELETE", `/documents/${r.body.id}`);
    if (created.has(r.body.id) && d.status < 300) created.delete(r.body.id);
    const g = await api("GET", `/documents/${r.body.id}`);
    return { ok: d.status < 300 && g.status === 404, detail: `del=${d.status} get=${g.status}` };
  },
};

// content scenario: seed a doc, apply ops, verify readback contains `expect`.
async function contentScenario(ops, expect) {
  const r = await makeDoc(uniq("content"));
  if (r.status !== 201) return { ok: false, detail: "doc create failed" };
  const e = await editDoc(r.body.id, ops);
  if (e.status !== 201) return { ok: false, detail: `edit status ${e.status}: ${JSON.stringify(e.body).slice(0, 80)}` };
  const { plainText, lexicalJson } = await readbackUntil(r.body.id, expect);
  const hay = lexicalJson + "\n" + plainText;
  const missing = expect.filter((s) => !hay.includes(s));
  return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : "ok" };
}

const CONTENT = {
  "paragraph": () => { const t = uniq("para"); return contentScenario([{ op: "paragraph", text: t }], [t]); },
  "heading": () => { const t = uniq("head"); return contentScenario([{ op: "heading", level: (SEQ % 3) + 1, text: t }], [t, '"type":"heading"']); },
  "bold": () => { const t = uniq("b"); return contentScenario([{ op: "paragraph", text: t, format: ["bold"] }], [t, '"format":1']); },
  "italic": () => { const t = uniq("i"); return contentScenario([{ op: "paragraph", text: t, format: ["italic"] }], [t, '"format":2']); },
  "underline": () => { const t = uniq("u"); return contentScenario([{ op: "paragraph", text: t, format: ["underline"] }], [t, '"format":8']); },
  "strikethrough": () => { const t = uniq("s"); return contentScenario([{ op: "paragraph", text: t, format: ["strikethrough"] }], ['"format":4']); },
  "code-format": () => { const t = uniq("c"); return contentScenario([{ op: "paragraph", text: t, format: ["code"] }], ['"format":16']); },
  "highlight": () => { const t = uniq("h"); return contentScenario([{ op: "paragraph", text: t, format: ["highlight"] }], ['"format":128']); },
  "font-size": () => contentScenario([{ op: "paragraph", runs: [{ text: uniq("fs"), fontSize: 22 }] }], ["font-size: 22px"]),
  "font-color": () => contentScenario([{ op: "paragraph", runs: [{ text: uniq("fc"), color: "#3366cc" }] }], ["color: #3366cc"]),
  "font-highlight": () => contentScenario([{ op: "paragraph", runs: [{ text: uniq("fh"), highlight: "#ffee00" }] }], ["background-color: #ffee00"]),
  "link": () => { const u = `https://ex.test/${uniq("l")}`; return contentScenario([{ op: "paragraph", runs: [{ text: "click", href: u }] }], ['"type":"link"', u]); },
  "list-bullet": () => contentScenario([{ op: "list", listType: "bullet", items: [uniq("a"), uniq("b")] }], ['"listType":"bullet"']),
  "list-number": () => contentScenario([{ op: "list", listType: "number", items: [uniq("n1"), uniq("n2")] }], ['"listType":"number"']),
  "list-check": () => contentScenario([{ op: "list", listType: "check", items: [{ text: uniq("ck"), checked: true }] }], ['"listType":"check"', '"checked":true']),
  "quote": () => { const t = uniq("q"); return contentScenario([{ op: "quote", text: t }], [t, '"type":"quote"']); },
  "code-block": () => contentScenario([{ op: "code", language: "js", text: uniq("cb") }], ['"type":"code"']),
  "table": () => contentScenario([{ op: "table", header: true, rows: [["H1", "H2"], [uniq("c1"), uniq("c2")]] }], ['"type":"table"', '"colWidths"']),
  "columns": () => contentScenario([{ op: "columns", columns: [[{ op: "paragraph", text: uniq("L") }], [{ op: "paragraph", text: uniq("R") }]] }], ["layout-container", "layout-item"]),
  "image": () => { const s = `https://img.test/${uniq("im")}.png`; return contentScenario([{ op: "image", src: s, altText: "x" }], ['"type":"image"', s]); },
  "embed": () => { const s = `https://embed.test/${uniq("em")}`; return contentScenario([{ op: "embed", src: s }], ['"type":"embed-media"', s]); },
  "file": () => { const s = `https://file.test/${uniq("fl")}.pdf`; return contentScenario([{ op: "file", src: s, mimeType: "application/pdf" }], ['"type":"embed-media"', "application/pdf"]); },
  "inline-mixed": () => { const a = uniq("m1"), b = uniq("m2"); return contentScenario([{ op: "paragraph", runs: [{ text: a, format: ["bold"] }, { text: b, color: "#e11" }] }], [a, b, '"format":1', "color: #e11"]); },
  "additive-append": async () => {
    const r = await makeDoc(uniq("add"));
    const t1 = uniq("first"), t2 = uniq("second");
    await editDoc(r.body.id, [{ op: "heading", level: 1, text: t1 }]);
    await editDoc(r.body.id, [{ op: "paragraph", text: t2 }]);
    const { plainText } = await readbackUntil(r.body.id, [t1, t2]);
    return { ok: plainText.includes(t1) && plainText.includes(t2), detail: plainText.includes(t1) && plainText.includes(t2) ? "ok" : "lost content" };
  },
};

// ---- build the scenario list (weighted to >= COUNT) ------------------------
function buildScenarios(n) {
  const structureKeys = Object.keys(STRUCTURE);
  const contentKeys = Object.keys(CONTENT);
  const list = [];
  // ~35% structure, ~65% content, round-robin within each for even coverage.
  const nStruct = Math.floor(n * 0.35);
  const nContent = n - nStruct;
  for (let i = 0; i < nStruct; i++) {
    const k = structureKeys[i % structureKeys.length];
    list.push({ category: k, run: STRUCTURE[k] });
  }
  for (let i = 0; i < nContent; i++) {
    const k = contentKeys[i % contentKeys.length];
    list.push({ category: k, run: CONTENT[k] });
  }
  // shuffle deterministically (no Math.random — index-based)
  for (let i = list.length - 1; i > 0; i--) {
    const j = (i * 1103515245 + 12345) % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---- run with bounded concurrency ------------------------------------------
async function runPool(items, k, worker, onTick) {
  const results = new Array(items.length);
  let idx = 0, done = 0;
  async function lane() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await worker(items[i], i); }
      catch (e) { results[i] = { category: items[i].category, ok: false, detail: `threw: ${e.message}` }; }
      if (onTick && ++done % 100 === 0) onTick(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: k }, lane));
  return results;
}

async function main() {
  const t0 = Date.now();
  console.log(`benchmark: ${COUNT} scenarios, concurrency ${CONCURRENCY}, cleanup=${!KEEP}\n`);
  const scenarios = buildScenarios(COUNT);
  const results = await runPool(scenarios, CONCURRENCY, async (s, i) => {
    const r = await s.run(i);
    return { category: s.category, ok: r.ok, detail: r.detail };
  }, (d, total) => console.log(`  …${d}/${total}`));

  // aggregate
  const agg = {};
  for (const r of results) {
    (agg[r.category] ??= { pass: 0, fail: 0, fails: [] });
    if (r.ok) agg[r.category].pass++;
    else { agg[r.category].fail++; if (agg[r.category].fails.length < 3) agg[r.category].fails.push(r.detail); }
  }
  const totalPass = results.filter((r) => r.ok).length;

  console.log(`\n==== ACCURACY BY CATEGORY ====`);
  const rows = Object.entries(agg).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [cat, s] of rows) {
    const n = s.pass + s.fail; const pct = ((s.pass / n) * 100).toFixed(1);
    const bar = pct === "100.0" ? "✓" : "✗";
    console.log(`  ${bar} ${cat.padEnd(18)} ${String(s.pass).padStart(4)}/${String(n).padEnd(4)} ${pct}%${s.fails.length ? "   e.g. " + s.fails[0] : ""}`);
  }
  console.log(`\n==== OVERALL: ${totalPass}/${results.length} = ${((totalPass / results.length) * 100).toFixed(2)}%  (${((Date.now() - t0) / 1000).toFixed(1)}s) ====`);

  // cleanup
  if (!KEEP) {
    process.stdout.write(`\ncleaning up ${created.size} docs… `);
    const ids = [...created];
    await runPool(ids.map((id) => ({ id })), 6, async ({ id }) => { await api("DELETE", `/documents/${id}`).catch(() => {}); });
    console.log("done");
  } else {
    console.log(`\n(kept ${created.size} docs)`);
  }
  process.exit(totalPass === results.length ? 0 : 2);
}
main().catch((e) => { console.error("benchmark crashed:", e); process.exit(1); });
