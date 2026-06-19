---
name: ai-doc
description: Author and edit toddle-compose documents from natural language — create workspaces' docs and nested docs, and apply rich content (headings, paragraphs, rich text + inline formatting, lists, tables, columns, images, link/file embeds) to a doc. Use when asked to build or update document structure/content in toddle-compose, e.g. "in workspace <url>, create a doc 'release', a sub-doc 'release-1.1', and a populated table".
---

# ai-doc

Drive the toddle-compose API to build document **structure** (docs, nesting, rename,
move, delete) and **content** (rich text, lists, tables, columns, images, embeds),
authenticating as an **access token** (the `ctk_…` credential).

Everything here runs through one self-contained CLI — **`compose.mjs`** — which only
needs three env vars and a deployed backend + rtc-server. You do **not** need the
application source code to use this skill; the content engine runs server-side.

## Setup (once per session)

```bash
export COMPOSE_API_URL=http://localhost:4000   # backend REST (structure + auth)
export COMPOSE_RTC_URL=http://localhost:4001   # rtc-server (content writes)
export COMPOSE_TOKEN=ctk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # access token, EDIT/ADMIN scope
```

Run everything as `node <skill-dir>/compose.mjs <cmd> [flags]`. The token's
scope/permission govern what's allowed: a WORKSPACE-scoped token only touches its
own workspace (404 elsewhere); content edits need an **editor** role (EDIT/ADMIN).
A workspace URL `http://host/w/<id>` carries the id in `/w/<id>` — pass the URL or
the bare id to `--workspace`.

```bash
node compose.mjs whoami          # confirm identity + active workspace
node compose.mjs workspaces      # list accessible workspaces
```

## Structure commands (REST — rock solid, verified 100%)

```bash
node compose.mjs tree --workspace <url|id>                       # list docs
node compose.mjs create-doc --workspace <url|id> --title "Release"          # → returns {id,...}
node compose.mjs create-doc --workspace <url|id> --parent <docId> --title "Release 1.1"   # nested
node compose.mjs create-doc --workspace <url|id> --title "Data" --type SHEET # data-grid doc
node compose.mjs get      --doc <id>                             # fetch one doc
node compose.mjs subdocs  --doc <id>                             # direct children
node compose.mjs rename   --doc <id> --title "New title"
node compose.mjs move     --doc <id> --parent <newParentId>      # omit --parent → top level
node compose.mjs visibility --doc <id> --value PUBLIC            # PRIVATE | PUBLIC
node compose.mjs delete   --doc <id>
```

`create-doc` prints the new doc as JSON; grab `.id` for nesting/content. Nest to any
depth by passing the parent's id to `--parent`.

## Content commands (rich authoring)

Document content is collaborative Lexical state (synced via Yjs) — **not** a REST
field. Author it with a high-level **op array**; the rtc-server builds the exact
Yjs delta the editor itself would produce and persists + live-broadcasts it.

```bash
node compose.mjs edit --doc <id> --ops '<json-array-of-ops>'
node compose.mjs edit --doc <id> --ops-file <path-to-json>
```

**Edits are additive**: every op appends to the document; prior content is kept and
new content merges cleanly even while someone is editing live. (See Concurrency.)

### Op reference

All ops are objects with an `op` field. A list of ops is applied in order.

**Rich text** uses either a flat `text` (one style for the whole block) or `runs`
(an array of independently-styled segments → inline mixed formatting). A **run** is:

```jsonc
{ "text": "hello",
  "format": ["bold","italic","underline","strikethrough","code","highlight"],  // any subset
  "fontSize": 20,            // number → px (or a CSS string like "1.5em")
  "color": "#e11d48",        // text color
  "highlight": "#fde68a",    // highlight (background-color)
  "href": "https://…" }      // wrap this run in a link
```

| op | shape | notes |
|----|-------|-------|
| `paragraph` | `{op:"paragraph", text?, format?, runs?, fontSize?, color?, highlight?}` | flat or `runs` |
| `heading`   | `{op:"heading", level:1\|2\|3, text?, format?, runs?}` | |
| `quote`     | `{op:"quote", text?, runs?}` | blockquote |
| `code`      | `{op:"code", text?, language?}` | code block |
| `list`      | `{op:"list", listType:"bullet"\|"number"\|"check", items:[ "txt" \| {text?,runs?,checked?} ]}` | number = auto-ordered; check = checkboxes via `checked` |
| `table`     | `{op:"table", header?:bool, rows:string[][], columnWidths?:number[], tableWidth?:number}` | first row is the header when `header:true`; columns auto-fill the page width evenly unless `columnWidths` given |
| `columns`   | `{op:"columns", columns: Op[][]}` | each inner array is the block ops for one column; renders as equal-width columns; sub-ops may be any block (incl. nested columns) |
| `image`     | `{op:"image", src, altText?, width?, height?, maxWidth?, caption?}` | `src` = image URL; `width/height` 0/omitted = natural; `maxWidth` caps (default 584) |
| `embed`     | `{op:"embed", src, mimeType?, width?, height?, maxWidth?}` | **embed a link/media** by URL; set `mimeType` for non-HTML media (e.g. `video/mp4`) |
| `file`      | `{op:"file", src, mimeType?, fileName?}` | embed a file by URL (same node as `embed`) |
| `clear`     | `{op:"clear"}` | ⚠️ destructive — wipes the doc; **refused while anyone has it open** (see Concurrency) |

Text format bit values (how they appear in the stored doc): bold=1, italic=2,
strikethrough=4, underline=8, code=16, highlight=128 (combine by adding). Inline
`fontSize`/`color`/`highlight` are written to the text node's CSS `style` string.

### Worked example

```bash
node compose.mjs edit --doc <id> --ops '[
  {"op":"heading","level":1,"text":"Release Notes"},
  {"op":"paragraph","runs":[
    {"text":"Shipped "},
    {"text":"v2.0","format":["bold"],"color":"#0a7"},
    {"text":" — see the "},
    {"text":"changelog","href":"https://example.com/changelog"}
  ]},
  {"op":"list","listType":"check","items":[
    {"text":"Docs updated","checked":true},
    {"text":"Migration guide","checked":false}
  ]},
  {"op":"table","header":true,"rows":[
    ["Area","Status"],["API","Done"],["UI","In progress"]
  ]},
  {"op":"columns","columns":[
    [{"op":"paragraph","text":"Left column"}],
    [{"op":"image","src":"https://picsum.photos/300/180","altText":"shot"}]
  ]},
  {"op":"embed","src":"https://www.youtube.com/watch?v=VIDEO"}
]'
```

## ⚠️ Concurrency safety (additive-only)

- **Edits are additive by default — never `clear` a doc someone may have open.** A
  destructive `clear` racing with a connected editor can corrupt the doc (the
  deletions conflict with the live client and can resolve to empty content).
- **The server enforces this**: `edit` is rejected with HTTP 400 if it contains a
  `clear` (or other destructive op) while ≥1 editor has the doc open. Append-style
  ops are CRDT-safe and always allowed. To replace content, prefer appending; only
  `clear` a doc that is idle (nobody connected).
- If a doc ever gets corrupted by a past destructive race, an operator can reset it
  with the internal purge `DELETE <RTC_URL>/internal/docs/:id` (clears the content
  history but keeps the doc itself), then re-apply additively.

## Reliability

A 1000+ scenario benchmark (every structure + content op, run concurrently)
measures **structure ops at 100%** and **content ops ~97%+** with the server stable
throughout. (The residual is verification reading the async-persisted snapshot a beat
too early under load, not a content error — each op type reaches 100% on settled
reads.) The rtc-server tolerates transient DB contention under load (transaction
retries + a non-fatal unhandled-rejection policy) instead of crashing.

## Troubleshooting

- `401/invalid rtc token` — `COMPOSE_TOKEN` missing/expired, or not an editor on the doc.
- `403 token docId mismatch` / 404 — token is scoped to another doc/workspace.
- `edit … 400 refusing destructive op` — you sent `clear` while an editor is connected; append instead, or wait until the doc is idle.
- content not visible immediately — persistence/extraction is async; re-read after ~1s.

---

## Maintainer notes (require the application repo — not needed to USE the skill)

The content engine is `rtc-server/src/content/content-builder.ts` (high-level ops →
real headless Lexical↔Yjs delta) behind `POST <RTC_URL>/docs/:id/edit`. The
additive-safety guard lives in `DocStateService.editDoc` (refuses destructive ops
when `conns > 0`). Resilience: `appendDocUpdate` retries transient Prisma tx errors
(P2028/P2034); `main.ts` treats `unhandledRejection` as non-fatal.

Editor node set is bundled to `rtc-server/vendor/server-nodes.cjs` from
`doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js` via
`pnpm --filter rtc-server bundle:nodes`. image/embed/file required adding `ImageNode`
+ `EmbedMediaNode` there and updating the bundle script to: load `.scss` as empty,
bundle react in, and stub browser-only UI (`@lexical/react`, react-dom, `*Component`/
embed-viewer modules, and `@lexical/{selection,clipboard,html,offset}` whose
`.node.mjs` use top-level await). YouTube is omitted (extends `@lexical/react`).

Dev/verification tools in this skill dir (all require the repo + a built rtc-server):
- `harness.cjs` — in-process build→extract of ops (no server). Self-tests + `--ops`.
- `ops-tests.cjs` — asserts every op/format (29 checks) via the harness.
- `concurrency-test.cjs` — real WS client: proves edits are additive + `clear` is refused while connected.
- `benchmark.cjs` — `--count N [--keep] [--concurrency K]` accuracy benchmark with auto-cleanup.

To learn a brand-new node's JSON shape: run the rtc-server with
`RTC_CAPTURE_UPDATES=1`, do the edit in the browser, grab the logged `b64=` update,
replay with `compose.mjs apply-update --doc <id> --b64 <…>`, then encode it as an op.
