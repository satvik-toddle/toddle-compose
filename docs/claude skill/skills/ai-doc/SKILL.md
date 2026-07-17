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
export COMPOSE_TOKEN=<token here>   # access token, EDIT/ADMIN scope
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
node compose.mjs read --doc <id>                                 # content outline (parentId + text)
node compose.mjs find --doc <id> --text "<str>" [--nth <n>]      # locate text → {parentId,offset,end,…}
```

**Edits are additive**: every op appends to the document; prior content is kept and
new content merges cleanly even while someone is editing live. (See Concurrency.)

### Op reference

All ops are objects with an `op` field. A list of ops is applied in order.

**Rich text** uses either a flat `text` (one style for the whole block) or `runs`
(an array of independently-styled segments → inline mixed formatting). A **run** is:

```jsonc
{
  "text": "hello",
  "format": ["bold", "italic", "underline", "strikethrough", "code", "highlight"], // any subset
  "fontSize": 20, // number → px (or a CSS string like "1.5em")
  "color": "#e11d48", // text color
  "highlight": "#fde68a", // highlight (background-color)
  "href": "https://…",
} // wrap this run in a link
```

| op          | shape                                                                                          | notes                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph` | `{op:"paragraph", text?, format?, runs?, fontSize?, color?, highlight?}`                       | flat or `runs`                                                                                                                    |
| `heading`   | `{op:"heading", level:1-6, text?, format?, runs?}`                                             |                                                                                                                                   |
| `quote`     | `{op:"quote", text?, runs?}`                                                                   | blockquote                                                                                                                        |
| `code`      | `{op:"code", text?, language?}`                                                                | code block                                                                                                                        |
| `list`      | `{op:"list", listType:"bullet"\|"number"\|"check", items:[ "txt" \| {text?,runs?,checked?} ]}` | number = auto-ordered; check = checkboxes via `checked`                                                                           |
| `table`     | `{op:"table", header?:bool, rows:string[][], columnWidths?:number[], tableWidth?:number}`      | first row is the header when `header:true`; columns auto-fill the page width evenly unless `columnWidths` given                   |
| `columns`   | `{op:"columns", columns: Op[][], weights?:number[]}`                                           | each inner array is the block ops for one column; `weights` sets relative widths (like CSS fr units, e.g. `[1,2]`), default equal |
| `image`     | `{op:"image", src, altText?, width?, height?, maxWidth?, caption?, href?}`                     | `src` = image URL; `width/height` 0/omitted = natural; `maxWidth` caps (default 584); `href` links the image                      |
| `embed`     | `{op:"embed", src, mimeType?, width?, height?, maxWidth?}`                                     | **embed a link/media** by URL; set `mimeType` for non-HTML media (e.g. `video/mp4`)                                               |
| `file`      | `{op:"file", src, mimeType?, fileName?}`                                                       | embed a file by URL (same node as `embed`)                                                                                        |
| `clear`     | `{op:"clear"}`                                                                                 | ⚠️ destructive — wipes the doc; **refused while anyone has it open** (see Concurrency)                                            |

The ops above are **whole-block authoring**. To change text that's **already in
the doc** — bold a word, recolor a phrase, fix a typo — do NOT clear and re-author.
**Read the doc, then issue concrete in-place ops.**

**Step 1 — read** to get block indices (`parentId`) and text:

```bash
node compose.mjs read --doc <id>
# → { blocks:[ {parentId:0,type:"heading",text:"…",length:N}, … ], raw:"<lexical json>" }
```

**Step 2 — locate your target with `find`** (don't hand-compute offsets). It
scans the same block text `read` returns and hands back ready-to-use points:

```bash
node compose.mjs find --doc <id> --text "CLEAR_HISTORY_COMMAND"
# → [ {parentId:27, offset:28, end:49, blockType:"list", context:"…dropped the CLEAR…"}, … ]
node compose.mjs find --doc <id> --text "<strong>" --nth 1   # → just the 1st match (or null)
```

Feed `parentId`/`offset`/`end` straight into a `format`/`delete`/`insert` op.
The offsets are **flat, block-local character offsets** that work uniformly for
paragraphs, headings, **lists, columns, and TABLE cells** — `read` flattens each
block's descendant text in document order, and the server's selection resolver
walks that same order, so e.g. bolding a word inside a table cell or a single
list item works exactly like a paragraph.

**Step 3 — edit in place.** In-place ops use Lexical's selection shape — an
`anchor` and `focus` point, each `{parentId, offset}` (block index + character
offset). The server builds a real `RangeSelection` and runs the editor's own
`formatText`/`insertText`, so the Yjs op is exactly a user's select-and-edit:
minimal, surgical, and **safe while an editor is connected**.

> **⚠️ This is a live RTC doc — indices are volatile.** Collaborators can edit,
> reorder, **clear, or delete** the doc concurrently, so block indices and offsets
> are valid only for the state you just read. Always run `read`/`find`
> **immediately before** the edit and feed that output straight in — never reuse
> indices from an earlier turn. When adding blocks, prefer the **relative** `insert`
> (`insertAfter`/`insertBefore`/`parentOffset`) over an absolute index, since it
> re-anchors to a neighbour instead of pinning a position that may have shifted.
> Note `read`/`find` return an **empty doc (not an error) even for a deleted
> docId** — if blocks come back empty, confirm the doc still exists with
> `get --doc <id>` (the REST source of truth; a deleted doc returns 404) before
> assuming your edit landed.

| op       | shape                                                                                                                                                                                     | notes                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `format` | `{op:"format", anchor:{parentId,offset}, focus:{parentId,offset}, operations?:[…], color?, fontSize?, highlight?}`                                                                        | format/style just the selected range. e.g. `{op:"format", anchor:{parentId:1,offset:10}, focus:{parentId:1,offset:15}, operations:["bold"]}`    |
| `delete` | `{op:"delete", anchor:{parentId,offset}, focus:{parentId,offset}}`                                                                                                                        | remove the selected range                                                                                                                       |
| `insert` | caret: `{op:"insert", anchor:{parentId,offset}, text}` · new block: `{op:"insert", insertAfter\|insertBefore:<blockIndex>, text\|block}` or `{op:"insert", parentOffset:<childIndex>, …}` | insert text at a caret, or a new block positioned relative to a block. e.g. add `'s` → `{op:"insert", anchor:{parentId:0,offset:7}, text:"'s"}` |
| `align` | `{op:"align", block:<blockIndex>, align:"left"\|"center"\|"right"\|"justify"}` | set an existing block's alignment |
| `tableAddRow` | `{op:"tableAddRow", table:<blockIndex>, cells?:string[], at?:<rowIndex>}` | insert a row before `at` (omit → append); missing cells are empty |
| `tableAddColumn` | `{op:"tableAddColumn", table:<blockIndex>, cells?:string[], at?:<colIndex>, width?:px}` | insert a column before `at` (omit → append); one cell per row top-to-bottom; the header row's state is preserved |
| `tableDeleteRow` | `{op:"tableDeleteRow", table:<blockIndex>, row:<rowIndex>}` | remove one row |
| `tableDeleteColumn` | `{op:"tableDeleteColumn", table:<blockIndex>, col:<colIndex>}` | remove one column; column widths update |
| `tableSetCell` | `{op:"tableSetCell", table:<blockIndex>, row, col, text?\|runs?, background?:color}` | replace one cell's content and/or set its background color |
| `tableSetWidths` | `{op:"tableSetWidths", table:<blockIndex>, columnWidths?:number[], tableWidth?:px}` | resize an existing table's columns (same width semantics as `table`) |
| `resizeColumns` | `{op:"resizeColumns", columns:<blockIndex>, weights:number[]}` | re-weight an existing column layout, e.g. `[1,2]` = second column twice as wide (one weight per column) |

Structure ops (`table*`, `resizeColumns`, `align`) address blocks by the same
top-level indices `read` reports, and **throw (HTTP 400) when the target block,
row, column, or cell doesn't exist** — a `{ok:true}` response means the edit
really landed.

There is **no `replace` op by design** — replacement is ambiguous (which of N
matches?). To replace, compose concrete ops from the read: `delete` the range then
`insert` the new text. Multiple ops in one `edit` apply in order. Verified surgical
across 1500+ permutations (incl. multi-op) and live on a connected doc.

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

## ⚠️ NEVER use `clear` unless the user explicitly asks

`clear` wipes the whole doc. **Do not use it to edit, restyle, or fix existing
content** — that's what the read + in-place ops are for. Only emit `clear` when the
user literally asks to empty/reset a doc.

- To **change existing content** (bold a word, recolor, fix a typo, replace a
  phrase): `read` → compute offsets → `format`/`delete`/`insert`. Never clear+re-author.
- Append (new blocks) and all in-place ops are CRDT-safe and **allowed while an
  editor is connected**. `clear` racing with a live editor can corrupt the doc, so
  **the server rejects `clear` with HTTP 400 while ≥1 editor has the doc open.**
- If a doc was corrupted by a past destructive race, an operator can reset its
  content with `DELETE <RTC_URL>/internal/docs/:id` (keeps the doc node), then
  re-author additively.

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

- `EmbedMediaNode` there and updating the bundle script to: load `.scss` as empty,
  bundle react in, and stub browser-only UI (`@lexical/react`, react-dom, `*Component`/
  embed-viewer modules, and `@lexical/{selection,clipboard,html,offset}` whose
  `.node.mjs` use top-level await). YouTube is omitted (extends `@lexical/react`).

The ops were validated against the live stack (every node/format verified; a
1000+ scenario concurrent benchmark measured structure ops at 100% and content
ops ~97% with the server stable). The verification scripts used for that
(in-process build→extract harness, per-op assertions, a real-WS-client additive
test, and the benchmark) are not shipped with the skill — they require the repo
and a built rtc-server, and can be recreated against `buildOpsUpdate` /
`extractFromBytesSync` and the `edit` endpoint if needed.

To learn a brand-new node's JSON shape: run the rtc-server with
`RTC_CAPTURE_UPDATES=1`, do the edit in the browser, grab the logged `b64=` update,
replay with `compose.mjs apply-update --doc <id> --b64 <…>`, then encode it as an op.
