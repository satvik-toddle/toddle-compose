#!/usr/bin/env node
// Integration test: AI edits must be additive while a user has the doc open.
// Simulates a connected editor with a real WS client, then drives the content
// `edit` endpoint and asserts:
//   1. an additive append SUCCEEDS and the live client receives it (doc grows),
//   2. a destructive `clear` is REFUSED while the client is connected,
//   3. once the client disconnects, `clear` is allowed again.
//
//   node concurrency-test.cjs
// Requires the full stack up (backend:4000, rtc:4001) and an EDIT-scoped token.

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../../..");
const WS = require(path.join(ROOT, "rtc-server/node_modules/ws"));
const Y = require(require.resolve("yjs", { paths: [path.join(ROOT, "rtc-server/dist/content")] }));

const API = process.env.COMPOSE_API_URL ?? "http://localhost:4000";
const RTC = process.env.COMPOSE_RTC_URL ?? "http://localhost:4001";
const WSU = RTC.replace(/^http/, "ws");
const WORKSPACE = process.env.WS_ID ?? "cmqjgskux000dp641e23ar8sp";
const TOKEN = process.env.COMPOSE_TOKEN ?? "ctk_Kv4wq9hj8e2qQv4mjuTW-S0fzKx_4sBdiOc6Z9CHi38";
const INTERNAL = process.env.INTERNAL_TOKEN ?? "dev-internal-secret-change-me";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Use the skill CLI for structure + token minting (the real auth path).
function cli(args) {
  const out = execFileSync("node", [path.join(__dirname, "compose.mjs"), ...args],
    { env: { ...process.env, COMPOSE_API_URL: API, COMPOSE_RTC_URL: RTC, COMPOSE_TOKEN: TOKEN }, encoding: "utf8" });
  return JSON.parse(out);
}
async function edit(docId, ops) {
  const { token } = cli(["rtc-role", "--doc", docId]); // mints editor RTC token
  const res = await fetch(`${RTC}/docs/${docId}/edit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function plainText(docId) {
  const v = await (await fetch(`${RTC}/internal/docs/${docId}/versions`, { headers: { "X-Internal-Token": INTERNAL } })).json();
  if (!v.head) return "";
  const s = await (await fetch(`${RTC}/internal/docs/${docId}/versions/${v.head}`, { headers: { "X-Internal-Token": INTERNAL } })).json();
  return s.plainText ?? "";
}

// Open a real WS client to the doc (counts as a live editor in conns).
function connect(docId, token) {
  const ws = new WS(`${WSU}/yjs/${docId}?token=${encodeURIComponent(token)}`, ["yjs"]);
  const ydoc = new Y.Doc();
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve({ ws, ydoc }));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 5000);
  });
}

async function main() {
  console.log(`API=${API} RTC=${RTC}\n`);
  const doc = cli(["create-doc", "--workspace", WORKSPACE, "--title", "concurrency-test"]);
  const id = doc.id;
  console.log("doc:", id);

  // Seed some content while nobody is connected.
  await edit(id, [{ op: "heading", level: 1, text: "Seed Heading" }, { op: "paragraph", text: "seed body" }]);
  const seeded = await plainText(id);
  ok(seeded.includes("Seed Heading"), "seed content present");

  // A user opens the doc.
  const { token } = cli(["rtc-role", "--doc", id]);
  const { ws } = await connect(id, token);
  await wait(500); // let the server register the connection
  console.log("(live editor connected)\n");

  console.log("1) additive append while a user is connected");
  {
    const r = await edit(id, [{ op: "paragraph", text: "AI appended line" }]);
    ok(r.status === 201 && r.body.ok, `append accepted (status ${r.status})`);
    await wait(400);
    const t = await plainText(id);
    ok(t.includes("Seed Heading"), "prior seed content preserved (additive)");
    ok(t.includes("AI appended line"), "appended content present");
  }

  console.log("\n2) destructive clear is refused while a user is connected");
  {
    const r = await edit(id, [{ op: "clear" }, { op: "paragraph", text: "wipe attempt" }]);
    ok(r.status >= 400, `clear rejected (status ${r.status})`);
    ok(JSON.stringify(r.body).toLowerCase().includes("additive"), "rejection explains additive-only rule");
    await wait(300);
    const t = await plainText(id);
    ok(t.includes("Seed Heading") && t.includes("AI appended line"), "doc NOT clobbered by refused clear");
    ok(!t.includes("wipe attempt"), "wipe attempt did not apply");
  }

  console.log("\n3) clear allowed again once the user disconnects");
  {
    ws.close();
    await wait(800); // let conns drain
    const r = await edit(id, [{ op: "clear" }, { op: "paragraph", text: "fresh after disconnect" }]);
    ok(r.status === 201 && r.body.ok, `clear accepted when idle (status ${r.status})`);
    await wait(400);
    const t = await plainText(id);
    ok(t.includes("fresh after disconnect") && !t.includes("Seed Heading"), "clear applied cleanly when idle");
  }

  // Cleanup: purge the test doc's RTC state + delete the doc node.
  try { await fetch(`${RTC}/internal/docs/${id}`, { method: "DELETE", headers: { "X-Internal-Token": INTERNAL } }); } catch {}
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("test crashed:", e); process.exit(1); });
