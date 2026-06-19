#!/usr/bin/env node
// Thin CLI over the toddle-compose API for AI-driven doc authoring.
// Auth: an access token (ctk_…) in COMPOSE_TOKEN. Base URL in COMPOSE_API_URL
// (default http://localhost:4000). Structure ops are plain REST; content ops go
// through the rtc apply-update path (raw Yjs update, base64).
//
// Usage:
//   node compose.mjs whoami
//   node compose.mjs workspaces
//   node compose.mjs tree --workspace <id>
//   node compose.mjs create-doc --workspace <id> [--parent <docId>] --title <t> [--type DOC|SHEET]
//   node compose.mjs rtc-role --doc <id>
//   node compose.mjs apply-update --doc <id> (--b64 <base64> | --file <path>)

const API = (process.env.COMPOSE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const RTC = (process.env.COMPOSE_RTC_URL ?? "http://localhost:4001").replace(/\/+$/, "");
const TOKEN = process.env.COMPOSE_TOKEN;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i] ?? true;
    else out._.push(a);
  }
  return out;
}

async function api(method, path, body) {
  if (!TOKEN) die("COMPOSE_TOKEN is not set (an access token, ctk_…)");
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) die(`${method} ${path} → ${res.status}: ${text}`);
  return data;
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function jwtExp(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return typeof p.exp === "number" ? p.exp : 0;
  } catch {
    return 0;
  }
}

// Mint (and cache) an editor RTC token for a doc. The backend applies the
// access-token cap/confinement here; the token is then reused for ~its TTL so
// content writes go straight to the rtc-server, not back through the backend.
async function rtcToken(docId) {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const fs = await import("node:fs");
  const cacheFile = join(tmpdir(), `compose-rtc-${docId}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (c.token && jwtExp(c.token) - 30 > Math.floor(Date.now() / 1000)) return c;
  } catch {
    /* no/expired cache */
  }
  const minted = await api("POST", `/documents/${encodeURIComponent(docId)}/rtc-token`);
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(minted));
  } catch {
    /* best-effort cache */
  }
  return minted;
}

// Content write straight to the rtc-server with a (cached) editor RTC token —
// the backend is not in this per-write path.
async function rtcPost(docId, action, body) {
  const { token, role } = await rtcToken(docId);
  if (role !== "editor") die(`token role is '${role}', need editor to write`);
  const res = await fetch(`${RTC}/docs/${encodeURIComponent(docId)}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) die(`rtc ${action} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
function out(v) {
  console.log(JSON.stringify(v, null, 2));
}

// Accept a raw workspace id or a UI URL like http://host/w/<id>.
function workspaceId(v) {
  if (!v) die("--workspace <id|url> required");
  const m = String(v).match(/\/w\/([^/?#]+)/);
  return m ? m[1] : String(v);
}

const cmd = process.argv[2];
const a = args(process.argv.slice(3));

switch (cmd) {
  case "whoami":
    out(await api("GET", "/auth/me"));
    break;
  case "workspaces":
    out(await api("GET", "/workspaces"));
    break;
  case "tree": {
    const ws = workspaceId(a.workspace);
    out(await api("GET", `/documents?workspaceId=${encodeURIComponent(ws)}`));
    break;
  }
  case "create-doc": {
    const ws = workspaceId(a.workspace);
    if (!a.title) die("--title <t> required");
    const body = { title: a.title, workspaceId: ws };
    if (a.parent) body.parentId = a.parent;
    if (a.type) body.type = a.type;
    out(await api("POST", "/documents", body));
    break;
  }
  case "rtc-role": {
    if (!a.doc) die("--doc <id> required");
    out(await api("POST", `/documents/${encodeURIComponent(a.doc)}/rtc-token`));
    break;
  }
  case "apply-update": {
    if (!a.doc) die("--doc <id> required");
    let b64 = a.b64;
    if (!b64 && a.file) {
      const { readFileSync } = await import("node:fs");
      b64 = readFileSync(a.file, "utf8").trim();
    }
    if (!b64) die("--b64 <base64> or --file <path> required");
    out(await rtcPost(a.doc, "apply-update", { update: b64 }));
    break;
  }
  case "edit": {
    if (!a.doc) die("--doc <id> required");
    let ops;
    if (a.ops) ops = JSON.parse(a.ops);
    else if (a["ops-file"]) {
      const { readFileSync } = await import("node:fs");
      ops = JSON.parse(readFileSync(a["ops-file"], "utf8"));
    } else die("--ops <json> or --ops-file <path> required (array of content ops)");
    if (!Array.isArray(ops)) die("ops must be a JSON array");
    out(await rtcPost(a.doc, "edit", { ops }));
    break;
  }
  default:
    die(`unknown command '${cmd}'. See header for usage.`);
}
