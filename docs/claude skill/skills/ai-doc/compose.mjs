#!/usr/bin/env node
// Thin CLI over the toddle-compose API for AI-driven doc authoring.
// Auth: an access token (ctk_…) in COMPOSE_TOKEN. Base URL in COMPOSE_API_URL
// (default http://localhost:4000). Structure ops are plain REST; content ops go
// through the rtc apply-update path (raw Yjs update, base64).
//
// Usage:
//   node compose.mjs whoami
//   node compose.mjs workspaces
//   node compose.mjs tree --workspace <id|url>
//   node compose.mjs create-doc --workspace <id|url> [--parent <docId>] --title <t> [--type DOC|SHEET]
//   node compose.mjs get --doc <id>
//   node compose.mjs subdocs --doc <id>
//   node compose.mjs rename --doc <id> --title <t>
//   node compose.mjs move --doc <id> [--parent <docId>]        (omit --parent → top level)
//   node compose.mjs visibility --doc <id> --value <PRIVATE|PUBLIC>
//   node compose.mjs delete --doc <id>
//   node compose.mjs read --doc <id>                          # content outline (parentId + text)
//   node compose.mjs find --doc <id> --text <str> [--nth <n>] # locate text → {parentId,offset,end,...}
//   node compose.mjs edit --doc <id> (--ops <json> | --ops-file <path>)   # content
//   node compose.mjs rtc-role --doc <id>
//   node compose.mjs apply-update --doc <id> (--b64 <base64> | --file <path>)

const API = (process.env.COMPOSE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const RTC = (process.env.COMPOSE_RTC_URL ?? 'http://localhost:4001').replace(/\/+$/, '');
const TOKEN = process.env.COMPOSE_TOKEN;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? true;
    else out._.push(a);
  }
  return out;
}

async function api(method, path, body) {
  if (!TOKEN) die('COMPOSE_TOKEN is not set (an access token, ctk_…)');
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return typeof p.exp === 'number' ? p.exp : 0;
  } catch {
    return 0;
  }
}

// Mint (and cache) an editor RTC token for a doc. The backend applies the
// access-token cap/confinement here; the token is then reused for ~its TTL so
// content writes go straight to the rtc-server, not back through the backend.
async function rtcToken(docId) {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const fs = await import('node:fs');
  const cacheFile = join(tmpdir(), `compose-rtc-${docId}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.token && jwtExp(c.token) - 30 > Math.floor(Date.now() / 1000)) return c;
  } catch {
    /* no/expired cache */
  }
  const minted = await api('POST', `/documents/${encodeURIComponent(docId)}/rtc-token`);
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
  if (role !== 'editor') die(`token role is '${role}', need editor to write`);
  const res = await fetch(`${RTC}/docs/${encodeURIComponent(docId)}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) die(`rtc ${action} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
// Read from the rtc-server with a (cached) RTC token — e.g. the content outline.
async function rtcGet(docId, action) {
  const { token } = await rtcToken(docId);
  const res = await fetch(`${RTC}/docs/${encodeURIComponent(docId)}/${action}`, {
    headers: { Authorization: `Bearer ${token}` },
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
  if (!v) die('--workspace <id|url> required');
  const m = String(v).match(/\/w\/([^/?#]+)/);
  return m ? m[1] : String(v);
}

const cmd = process.argv[2];
const a = args(process.argv.slice(3));

switch (cmd) {
  case 'whoami':
    out(await api('GET', '/auth/me'));
    break;
  case 'workspaces':
    out(await api('GET', '/workspaces'));
    break;
  case 'tree': {
    const ws = workspaceId(a.workspace);
    out(await api('GET', `/documents?workspaceId=${encodeURIComponent(ws)}`));
    break;
  }
  case 'create-doc': {
    const ws = workspaceId(a.workspace);
    if (!a.title) die('--title <t> required');
    const body = { title: a.title, workspaceId: ws };
    if (a.parent) body.parentId = a.parent;
    if (a.type) body.type = a.type;
    out(await api('POST', '/documents', body));
    break;
  }
  case 'get': {
    if (!a.doc) die('--doc <id> required');
    out(await api('GET', `/documents/${encodeURIComponent(a.doc)}`));
    break;
  }
  case 'subdocs': {
    if (!a.doc) die('--doc <id> required');
    out(await api('GET', `/documents/${encodeURIComponent(a.doc)}/subdocs`));
    break;
  }
  case 'rename': {
    if (!a.doc) die('--doc <id> required');
    if (!a.title) die('--title <t> required');
    out(await api('PATCH', `/documents/${encodeURIComponent(a.doc)}`, { title: a.title }));
    break;
  }
  case 'move': {
    if (!a.doc) die('--doc <id> required');
    // --parent <id> nests under a doc; --parent "" (or omit) moves to top level.
    const body = { parentId: a.parent && a.parent !== true ? a.parent : null };
    if (a.folder) body.folderId = a.folder;
    out(await api('PATCH', `/documents/${encodeURIComponent(a.doc)}/move`, body));
    break;
  }
  case 'visibility': {
    if (!a.doc) die('--doc <id> required');
    if (!a.value) die('--value <PRIVATE|PUBLIC> required');
    out(
      await api('PATCH', `/documents/${encodeURIComponent(a.doc)}/visibility`, {
        visibility: a.value,
      }),
    );
    break;
  }
  case 'delete': {
    if (!a.doc) die('--doc <id> required');
    out(await api('DELETE', `/documents/${encodeURIComponent(a.doc)}`));
    break;
  }
  case 'read': {
    // Read the doc's content outline: each block's parentId (index), type, and
    // text — what in-place edits (format/delete/insert) address by anchor/focus.
    if (!a.doc) die('--doc <id> required');
    out(await rtcGet(a.doc, 'content'));
    break;
  }
  case 'find': {
    // Locate text and return ready-to-use selection points. For each occurrence:
    // {parentId, offset, end, blockType, context} — feed parentId/offset/end
    // straight into a format/delete/insert op. Offsets are the same flat
    // block-local character offsets the in-place ops use, and work uniformly for
    // paragraphs, headings, lists, columns and TABLE cells (read flattens each
    // block's descendant text in document order; find scans that same text).
    //
    // ⚠️ This doc is live (RTC): block indices and offsets shift as collaborators
    // edit, so they are only valid for the current state. Always run `find`
    // IMMEDIATELY before the edit and feed its output straight in — never reuse
    // indices from an earlier read. Prefer relative `insert` (insertAfter/
    // insertBefore) when adding blocks, since those re-anchor instead of holding
    // an absolute index.
    if (!a.doc) die('--doc <id> required');
    if (a.text === undefined || a.text === true) die('--text <string> required');
    const needle = String(a.text);
    if (!needle.length) die('--text must be a non-empty string');
    const { blocks = [] } = await rtcGet(a.doc, 'content');
    if (blocks.length === 0) {
      // The rtc read returns an empty doc (not an error) even for a docId whose
      // document node was deleted — a collaborator can delete/empty a doc mid-edit
      // (it's a live RTC doc). Surface that instead of silently returning [].
      console.error(
        'warning: doc has no content blocks — it may be empty or DELETED. ' +
          'Confirm it still exists with: compose.mjs get --doc <id>',
      );
    }
    const matches = [];
    blocks.forEach((b, parentId) => {
      const t = b.text ?? '';
      let from = 0,
        i;
      while ((i = t.indexOf(needle, from)) !== -1) {
        matches.push({
          parentId,
          offset: i,
          end: i + needle.length,
          blockType: b.type,
          context: t.slice(Math.max(0, i - 30), i + needle.length + 30),
        });
        from = i + needle.length;
      }
    });
    const nth = a.nth !== undefined && a.nth !== true ? Number(a.nth) : null;
    out(nth ? (matches[nth - 1] ?? null) : matches);
    break;
  }
  case 'rtc-role': {
    if (!a.doc) die('--doc <id> required');
    out(await api('POST', `/documents/${encodeURIComponent(a.doc)}/rtc-token`));
    break;
  }
  case 'apply-update': {
    if (!a.doc) die('--doc <id> required');
    let b64 = a.b64;
    if (!b64 && a.file) {
      const { readFileSync } = await import('node:fs');
      b64 = readFileSync(a.file, 'utf8').trim();
    }
    if (!b64) die('--b64 <base64> or --file <path> required');
    out(await rtcPost(a.doc, 'apply-update', { update: b64 }));
    break;
  }
  case 'edit': {
    if (!a.doc) die('--doc <id> required');
    let ops;
    if (a.ops) ops = JSON.parse(a.ops);
    else if (a['ops-file']) {
      const { readFileSync } = await import('node:fs');
      ops = JSON.parse(readFileSync(a['ops-file'], 'utf8'));
    } else die('--ops <json> or --ops-file <path> required (array of content ops)');
    if (!Array.isArray(ops)) die('ops must be a JSON array');
    out(await rtcPost(a.doc, 'edit', { ops }));
    break;
  }
  default:
    die(`unknown command '${cmd}'. See header for usage.`);
}
