#!/usr/bin/env node
// End-to-end test for the server-side content builder. Drives the live stack:
//   create doc (backend, alice) → edit via RTC token (rtc-server) → read back the
//   extracted Lexical JSON (rtc internal) → assert. Run with all servers up:
//     node .claude/skills/ai-doc/test-content.mjs
import { readFileSync } from "node:fs";

const API = process.env.COMPOSE_API_URL ?? "http://localhost:4000";
const RTC = process.env.COMPOSE_RTC_URL ?? "http://localhost:4001";
const WS = process.env.WS_ID ?? "cmqjgskux000dp641e23ar8sp";

// INTERNAL_TOKEN for the read-back (rtc internal). From env or .env.
function internalToken() {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN;
  try {
    const env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
    const m = env.match(/^INTERNAL_TOKEN=(.*)$/m);
    if (m) return m[1].trim();
  } catch {
    /* fall through */
  }
  return "dev-internal-secret-change-me";
}
const INTERNAL = internalToken();

let pass = 0;
let fail = 0;
const created = [];
let jwt = "";

function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}

async function j(method, base, path, { token, internal, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (internal) headers["X-Internal-Token"] = INTERNAL;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function login() {
  const r = await j("POST", API, "/api/auth/login", {
    body: { email: "alice@toddle.test", password: "password123" },
  });
  if (r.status !== 201) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  jwt = r.body.accessToken;
}

async function createDoc(title, parentId) {
  const body = { title, workspaceId: WS };
  if (parentId) body.parentId = parentId;
  const r = await j("POST", API, "/api/documents", { token: jwt, body });
  if (r.status !== 201) throw new Error(`createDoc: ${r.status} ${JSON.stringify(r.body)}`);
  created.push(r.body.id);
  return r.body.id;
}

async function mintRtc(docId) {
  const r = await j("POST", API, `/api/documents/${docId}/rtc-token`, { token: jwt });
  if (r.status !== 201) throw new Error(`rtc-token: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body; // { token, role }
}

async function edit(docId, rtcTok, ops) {
  return j("POST", RTC, `/docs/${docId}/edit`, { token: rtcTok, body: { ops } });
}

// Latest extracted Lexical JSON (the raw lexicalJson string, so node-type and
// format substrings match without JSON double-escaping).
async function readback(docId) {
  const list = await j("GET", RTC, `/internal/docs/${docId}/versions`, { internal: true });
  const head = list.body.head ?? 0;
  if (head === 0) return "";
  const prev = await j("GET", RTC, `/internal/docs/${docId}/versions/${head}`, { internal: true });
  return prev.body.lexicalJson ?? "";
}

async function main() {
  console.log(`API=${API} RTC=${RTC} WS=${WS}`);
  await login();
  console.log("alice logged in\n");

  // 1) Structure: heading + paragraph + table (JavaScript vs Go).
  console.log("1) heading + paragraph + table");
  {
    const id = await createDoc(`builder-structure-${Date.now()}`);
    const { token, role } = await mintRtc(id);
    ok(role === "editor", "minted editor RTC token");
    const r = await edit(id, token, [
      { op: "heading", level: 1, text: "JavaScript vs Go" },
      { op: "paragraph", text: "A quick comparison." },
      {
        op: "table",
        header: true,
        rows: [
          ["Feature", "JavaScript", "Go"],
          ["Typing", "Dynamic", "Static"],
          ["Concurrency", "Event loop", "Goroutines"],
        ],
      },
    ]);
    ok(r.status === 201 && r.body.ok, `edit accepted (applied=${r.body.applied}B)`);
    const json = await readback(id);
    ok(json.includes("JavaScript vs Go"), "heading text present");
    ok(json.includes("A quick comparison."), "paragraph text present");
    ok(json.includes('"type":"heading"'), "heading node present");
    ok(json.includes('"type":"table"'), "table node present");
    ok(json.includes('"type":"tablerow"'), "table rows present");
    ok(json.includes('"type":"custom-table-cell"'), "uses the editor's custom-table-cell");
    ok(json.includes("Goroutines") && json.includes("Event loop"), "all cell values present");
  }

  // 2) Formatting: bold text (format bit 1).
  console.log("\n2) text formatting (bold)");
  {
    const id = await createDoc(`builder-format-${Date.now()}`);
    const { token } = await mintRtc(id);
    await edit(id, token, [{ op: "paragraph", text: "bold words", format: ["bold"] }]);
    const json = await readback(id);
    ok(json.includes("bold words"), "formatted text present");
    ok(json.includes('"format":1'), "bold format bit (1) set on the text node");
  }

  // 3) Append: a second edit adds to existing content.
  console.log("\n3) append across edits");
  {
    const id = await createDoc(`builder-append-${Date.now()}`);
    const { token } = await mintRtc(id);
    await edit(id, token, [{ op: "paragraph", text: "first para" }]);
    await edit(id, token, [{ op: "paragraph", text: "second para" }]);
    const json = await readback(id);
    ok(json.includes("first para") && json.includes("second para"), "both paragraphs present");
  }

  // 4) Clear then rebuild.
  console.log("\n4) clear + rebuild");
  {
    const id = await createDoc(`builder-clear-${Date.now()}`);
    const { token } = await mintRtc(id);
    await edit(id, token, [{ op: "paragraph", text: "stale content" }]);
    await edit(id, token, [{ op: "clear" }, { op: "paragraph", text: "fresh content" }]);
    const json = await readback(id);
    ok(json.includes("fresh content"), "new content present after clear");
    ok(!json.includes("stale content"), "old content gone after clear");
  }

  // 5) Auth.
  console.log("\n5) auth");
  {
    const id = await createDoc(`builder-auth-${Date.now()}`);
    const noTok = await edit(id, undefined, [{ op: "paragraph", text: "x" }]);
    ok(noTok.status === 401, "no token → 401");
    const other = await createDoc(`builder-auth2-${Date.now()}`);
    const { token: otherTok } = await mintRtc(other);
    const mismatch = await edit(id, otherTok, [{ op: "paragraph", text: "x" }]);
    ok(mismatch.status === 403, "token for a different doc → 403");
  }

  console.log("\n(all docs above were freshly created and never opened — cold-doc path)");

  // Cleanup.
  for (const id of created) {
    await j("DELETE", API, `/api/documents/${id}`, { token: jwt }).catch(() => {});
  }
  console.log(`\ncleaned up ${created.length} test doc(s)`);

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
