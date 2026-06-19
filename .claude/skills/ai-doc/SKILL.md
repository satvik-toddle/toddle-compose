---
name: ai-doc
description: Author and edit toddle-compose documents from natural language — create workspaces' docs and nested docs, and apply rich content (paragraphs, tables, cell edits, formatting, images) to a doc. Use when asked to build or update document structure/content in toddle-compose, e.g. "in workspace <url>, create a doc 'release', a sub-doc 'release-1.1', and a populated table".
---

# ai-doc

Drive the toddle-compose API to build document **structure** and **content**, authenticating as an **access token** (the `ctk_…` credential).

## Setup (once per session)

```bash
export COMPOSE_API_URL=http://localhost:4000        # backend
export COMPOSE_RTC_URL=http://localhost:4001        # rtc-server (content writes)
export COMPOSE_TOKEN=ctk_xxx                         # access token (EDIT+ scope)
```

The token's scope/permission govern what's allowed: a WORKSPACE token only touches its workspace; content edits need an **editor** role (EDIT/ADMIN). A workspace URL like `http://localhost:5173/w/<id>` carries the workspace id in `/w/<id>` — pass either the URL or the bare id.

Helper CLI (reliable REST + content apply): `node .claude/skills/ai-doc/compose.mjs <cmd>`.

## Structure (plain REST — solid)

```bash
node compose.mjs whoami                                   # confirm identity/scope
node compose.mjs workspaces                               # list accessible workspaces
node compose.mjs tree --workspace <url|id>                # existing docs
node compose.mjs create-doc --workspace <url|id> --title "release"
node compose.mjs create-doc --workspace <url|id> --parent <releaseDocId> --title "release-1.1"
```

`create-doc` returns the new doc (`id`). Nest by passing `--parent <docId>`. Use `--type SHEET` for a data-grid doc.

## Content (paragraphs, tables, cell edits, formatting, images)

Document **content** is collaborative Lexical state synced via Yjs to the rtc-server — it is **not** a REST field. We change it by applying a raw **Yjs update** to the doc:

```bash
node compose.mjs apply-update --doc <docId> --b64 <base64-yjs-update>
```

This uses a **two-step, backend-light** flow (mirrors the browser):
1. Mint an editor **RTC token** from the backend (`POST /api/documents/:id/rtc-token`) — the backend applies the access-token cap/confinement here, once. The CLI caches it for its ~5-min TTL.
2. Apply the update **directly to the rtc-server** (`POST <COMPOSE_RTC_URL>/docs/:id/apply-update`, `Authorization: Bearer <rtc-token>`). The backend is **not** in this per-update path.

The rtc-server verifies the RTC token (RS256/JWKS, same as the WS handshake), requires `role: editor` and a matching `docId`, then applies the update whether or not the doc is open: it **persists** the change and, if anyone has the doc open, **broadcasts it live**. A Yjs update is a minimal CRDT delta, so e.g. updating one table column changes only those cells.

### How we learn the update bytes for an operation (capture → mimic → verify → repeat)

We don't hand-write Yjs bytes. We learn each operation's update by observing a real UI edit:

1. **Enable capture** on the rtc-server: run it with `RTC_CAPTURE_UPDATES=1`. Every inbound update is logged as
   `[capture] docId=<id> origin=… sub=… bytes=N b64=<base64>`.
2. **Do the edit in the UI** (e.g. insert a table, type into a cell, bold a word) — one discrete action at a time.
3. **Grab the `b64=`** line(s) for that doc from the rtc-server logs.
4. **Mimic**: `node compose.mjs apply-update --doc <id> --b64 <captured>` and confirm the same change appears (in the UI / via `GET /api/documents/:id/history`).
5. **Record** the verified pattern below, noting which UI action it corresponds to and which bytes are the variable payload (text/cell/value), so it can be parameterized.

Repeat per operation. Build the library incrementally; prefer the smallest captured delta per action.

## Learned operations

_(Add verified patterns here as they're captured. Format: action → endpoint/bytes → how to parameterize.)_

- _none yet — start with the capture loop above._

## Notes / limits

- Raw-update replay reproduces a captured edit exactly. Parameterizing (arbitrary text/values) requires identifying the variable region of the delta; until a robust server-side op exists, capture a representative edit and adapt.
- Structure ops are stable REST; content ops are the evolving part.
- Never edit across workspaces with a WORKSPACE-scoped token — it's confined (404 elsewhere).
