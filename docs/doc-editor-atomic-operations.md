# Doc Editor — Atomic Operations Catalog

Every atomic operation the toddle-compose document editor supports, grouped by
category. This is the *user-facing* action surface (slash menu, toolbar, table
menu, drag handles) plus the *programmatic* op surface exposed by the `ai-doc`
content engine (`compose.mjs edit --ops`).

Legend:
- **UI** — reachable by a user in the editor (slash `/`, toolbar, context menu, etc.)
- **OP** — expressible as an `ai-doc` op (`compose.mjs edit`)
- **REST** — a structure operation on the doc node itself

---

## 1. Insert / create a block

| Operation | UI | OP |
|-----------|----|----|
| Write a paragraph | ✅ (default) | `paragraph` |
| Insert Heading 1 | ✅ `/h1` | `heading` `level:1` |
| Insert Heading 2 | ✅ `/h2` | `heading` `level:2` |
| Insert Heading 3 | ✅ `/h3` | `heading` `level:3` |
| Insert bulleted (unordered) list | ✅ `/bullet` | `list` `listType:"bullet"` |
| Insert numbered (ordered) list | ✅ `/number` | `list` `listType:"number"` |
| Insert check list | ✅ `/check` | `list` `listType:"check"` |
| Insert quote / blockquote | ✅ `/quote` | `quote` |
| Insert code block | ✅ `/code` | `code` (+ `language`) |
| Insert table (N×M) | ✅ `/table` | `table` |
| Insert columns / layout (2, 3, … cols) | ✅ `/columns` | `columns` |
| Insert divider / horizontal rule | ✅ `/divider` | — |
| Insert image from device (upload) | ✅ | `image` (via URL) |
| Insert image from URL | ✅ | `image` |
| Insert embed / media by URL | ✅ `/embed` | `embed` |
| Insert file attachment by URL | ✅ `/file` | `file` |
| Insert YouTube video | ✅ | `embed` (youtube URL) |
| Insert link | ✅ `/link` | run with `href` |
| Insert inline emoji | ✅ `/emoji` or `:` | (text) |
| Insert maths equation | ✅ | — |
| Insert collapsible container | ✅ | — |
| Toggle collapsible open/closed | ✅ | — |
| Insert smart placeholder | ✅ | — |
| Insert via Toddle AI (streamed) | ✅ `/ai` | — |

---

## 2. Convert / transform an existing block

Change the *type* of the current block (Lexical `setBlocksType`). All reachable
from the block-type dropdown in the toolbar or via `/`.

| Operation | UI |
|-----------|----|
| Convert → Paragraph | ✅ |
| Convert Paragraph → Heading 1 | ✅ |
| Convert Paragraph → Heading 2 | ✅ |
| Convert Paragraph → Heading 3 | ✅ |
| Convert → Bulleted list | ✅ |
| Convert → Numbered list | ✅ |
| Convert → Check list | ✅ |
| Convert → Quote | ✅ |
| Convert → Code block | ✅ |
| Convert any of the above back → Paragraph | ✅ |

> The `ai-doc` engine does not convert in place — to change a block's type it
> appends a new typed block (there is no `convert` op by design).

---

## 3. Inline text formatting (character-level)

Applied to a text selection. **OP:** via the `format` op with
`operations:[…]` / `color` / `highlight` / `fontSize`.

| Operation | UI | OP |
|-----------|----|----|
| Bold | ✅ | `format ["bold"]` (bit 1) |
| Italic | ✅ | `format ["italic"]` (bit 2) |
| Underline | ✅ | `format ["underline"]` (bit 8) |
| Strikethrough | ✅ | `format ["strikethrough"]` (bit 4) |
| Inline code | ✅ | `format ["code"]` (bit 16) |
| Highlight (background) | ✅ | `format ["highlight"]` (bit 128) / `highlight:"#…"` |
| Subscript | ✅ | — |
| Superscript | ✅ | — |
| Text color | ✅ | `format color:"#…"` |
| Background / highlight color | ✅ | `format highlight:"#…"` |
| Font size | ✅ | `format fontSize:N` |
| Add / edit link on selection | ✅ | run with `href` |
| Toggle / remove link | ✅ | — |
| Clear formatting | ✅ | — |
| Soft line break (Shift+Enter) | ✅ | — |
| Insert tab | ✅ | — |

---

## 4. Block-level formatting

| Operation | UI |
|-----------|----|
| Align left | ✅ |
| Align center | ✅ |
| Align right | ✅ |
| Justify | ✅ |
| Indent | ✅ (Tab) |
| Outdent | ✅ (Shift+Tab) |

---

## 5. List operations

| Operation | UI |
|-----------|----|
| Add list item (Enter) | ✅ |
| Nest / indent list item (Tab) | ✅ |
| Outdent list item (Shift+Tab) | ✅ |
| Toggle check-list item checked/unchecked | ✅ (`checked` in OP) |
| Exit list (Enter on empty item) | ✅ |

---

## 6. Table operations

Reachable from the per-cell action menu / table hover handles.

| Operation | UI |
|-----------|----|
| Insert row above | ✅ |
| Insert row below | ✅ |
| Insert column left | ✅ |
| Insert column right | ✅ |
| Delete row | ✅ |
| Delete column | ✅ |
| Delete table | ✅ |
| Merge selected cells | ✅ |
| Unmerge cell | ✅ |
| Toggle row header | ✅ |
| Toggle column header | ✅ |
| Set cell background color | ✅ |
| Resize column width | ✅ (drag) |
| Edit cell content / format text in cell | ✅ (OP: `format`/`insert`/`delete` with cell offsets) |

> On create, `table` OP sets `header`, `rows`, `columnWidths`, `tableWidth`.

---

## 7. Media / embed operations

| Operation | UI |
|-----------|----|
| Upload image (device) | ✅ |
| Insert image by URL | ✅ |
| Replace image | ✅ |
| Resize image (width/height/maxWidth) | ✅ (OP fields) |
| Add image caption / alt text | ✅ (OP: `caption`, `altText`) |
| Right-click image (context menu) | ✅ |
| Resize layout / column widths (drag) | ✅ |
| Insert embed media (link/video) | ✅ |
| Replace embed media | ✅ |
| Insert file attachment | ✅ |
| Insert YouTube video | ✅ |
| Theatre / fullscreen media view | ✅ |

---

## 8. In-place text editing (programmatic — `ai-doc`)

Surgical, CRDT-safe range ops that operate on already-existing content by
`{parentId, offset}` anchor/focus points.

| Op | Shape | Purpose |
|----|-------|---------|
| `format` | `{anchor, focus, operations?/color?/fontSize?/highlight?}` | style a selected range |
| `insert` (caret) | `{anchor:{parentId,offset}, text}` | insert text at a caret |
| `insert` (block) | `{insertAfter\|insertBefore:idx \| parentOffset:idx, text\|block}` | add a new block relative to another |
| `delete` | `{anchor, focus}` | remove a selected range |
| `clear` | `{op:"clear"}` | ⚠️ wipe whole doc (refused while an editor is connected) |

> There is **no `replace` op** — compose `delete` + `insert` instead.

---

## 9. Document lifecycle / undo

| Operation | UI |
|-----------|----|
| Undo | ✅ (Cmd/Ctrl+Z) |
| Redo | ✅ (Cmd/Ctrl+Shift+Z) |
| Drag-and-drop reorder a block | ✅ (drag handle) |
| Duplicate / delete a block (hover menu) | ✅ |
| Copy block | ✅ (hover) |
| Paste (rich / markdown / link → embed / drag-drop) | ✅ |
| Copy / cut selection | ✅ |
| Add comment on selection | ✅ |
| Add inline comment | ✅ |
| Reply to comment thread | ✅ |
| Resolve comment | ✅ |
| Delete comment | ✅ |

---

## 10. Doc structure operations (REST — `compose.mjs`)

Operate on the doc node itself, not its content.

| Operation | Command |
|-----------|---------|
| Create doc | `create-doc --title … [--type SHEET\|DIAGRAM]` |
| Create nested sub-doc | `create-doc --parent <id> --title …` |
| Rename doc | `rename --doc <id> --title …` |
| Move doc (reparent / to top level) | `move --doc <id> [--parent <id>]` |
| Change visibility | `visibility --doc <id> --value PRIVATE\|PUBLIC` |
| Delete doc | `delete --doc <id>` |
| List doc tree | `tree --workspace <id>` |
| Read doc content outline | `read --doc <id>` |
| Find text in doc | `find --doc <id> --text …` |

---

## 11. Version-history diff coverage ("show changes" → green/red)

Whether each operation is visible when history diff mode is on (`?diff=true`).
Added content tints **green** (`ds-de-content-added`), removed tints **red +
strikethrough** (`ds-de-content-removed`).

### The governing rule (post-fix)

The diff (`rtc-server/src/history/doc-diff.ts`) does a block-level LCS keyed on a
**full structural signature** (`nodeSignature`: type + every content-bearing
attribute — inline `format`/`style`, block `format`/`indent`, `checked`,
`language`, image `src`/`width`, table `headerState`/`backgroundColor`, etc. —
plus recursively the subtree). A word-level, **format-aware** diff runs inside
matched **simple-text** blocks (`paragraph`/`heading`/`quote`, text-only
children); everything else that differs is re-emitted as a whole old block (red)
+ whole new block (green).

> **Any change that alters a block's type, text, formatting, attributes, or
> structure is now visible.** Only truly no-op re-saves render clean (verified by
> a false-positive guard test). The diff still compares two saved **version
> snapshots** (editing sessions), not individual ops — many ops in one session
> collapse into one net diff.

### Verdict per operation (after the fix)

Legend: 🟢🔴 word-level (precise) · 🟩🟥 whole-block tint (coarse) · ❌ not shown

| Operation | Shown? | Notes |
|-----------|--------|-------|
| Type/insert/delete text in para/heading/quote | 🟢🔴 | precise word-level |
| Add / delete / duplicate a whole block | 🟩 / 🟥 | whole block green/red |
| Reorder / move a block | 🟩🟥 | red at old pos + green at new (no move detection) |
| **Convert** para↔heading↔quote↔list↔code | 🟩🟥 | old red block + new green block |
| **Bold / italic / underline / strike / inline code** | 🟢🔴 | ✅ fixed — word re-emitted old(struck)+new |
| **Highlight / text color / bg color / font size** | 🟢🔴 | ✅ fixed — via text `style` in signature/token key |
| **Subscript / superscript / clear formatting** | 🟢🔴 | ✅ fixed |
| **Add / remove link** (text unchanged) | 🟩🟥 | ✅ fixed — paragraph gains a link node → whole-block |
| **Align / indent / outdent** | 🟩🟥 | ✅ fixed — block-attr-only change → whole-block red+green |
| Add / remove / edit a list item | 🟩🟥 | whole old list red + whole new list green (coarse) |
| **Toggle checkbox** checked/unchecked | 🟩🟥 | ✅ fixed — `checked` in signature |
| **Nest / indent list item** | 🟩🟥 | ✅ fixed — `indent` in signature |
| Table: **delete / add a row** (incl. empty) | 🟢🔴 | ✅ granular — the removed row's cells tint red / added row green; other rows neutral |
| Table: **delete / add a column** (incl. empty) | 🟢🔴 | ✅ granular — the removed column's cell in every row tints red / added green |
| Table: **edit a cell's text** | 🟢🔴 | ✅ word-level diff inside the cell; other cells neutral |
| Table with **merged cells** (colSpan/rowSpan>1) | 🟩🟥 | falls back to whole-table red+green (grid ambiguous) |
| Table: **both** a row and a column change at once | 🟩🟥 | falls back to whole-table (can't separate the two axes) |
| Table: **toggle header** / **cell background** / **resize column** | 🟩🟥 | detected via signature; still whole-table (attr-only, no row/col/cell content change) |
| Code block: edit code / **change language** | 🟩🟥 | ✅ fixed — `language` in signature (whole-block) |
| Columns/layout: change text or **restructure/resize** | 🟩🟥 | ✅ fixed — attrs/structure in signature |
| Collapsible: change text or **toggle open/closed** | 🟩🟥 | ✅ fixed (if open/closed is serialized) |
| Image/embed/file/YouTube: **add / remove** | 🟩 / 🟥 | whole block green/red |
| **Inline** image inside a paragraph: add/remove/replace | 🟢🔴 | ✅ granular — text stays neutral, only the image gets an inline mark (paragraph is NOT whole-block tinted) |
| Image/embed: **replace** (A→B) | 🟩🟥 | ✅ fixed — `src` in signature (was lost before) |
| Image: **resize** / caption / alt text | 🟩🟥 | ✅ fixed — width/height/caption in signature |
| Divider / horizontal rule: add/remove | 🟩 / 🟥 | shown; multiple identical dividers still align by position |
| Soft line break / tab | 🟩🟥 | shown — paragraph gains a linebreak node → whole-block |
| Add / resolve / delete / reply comment | ❌ | by design — comments aren't document content, not in the snapshot |
| Undo / redo | — | diff reflects the resulting net state |

### Remaining, intentional limitations

1. **Granularity** — changes inside lists, code blocks, columns, and layouts
   surface as a **whole-block** red+green swap, not per-item / word-level.
   (Simple paragraphs/headings/quotes get word-level precision, including inline
   images/decorators, which are marked individually. **Tables** get per-row /
   per-column / per-cell granularity via cell background tinting — except tables
   with merged cells or simultaneous row+column changes, which fall back to
   whole-table.) A paragraph containing a **link** (inline element with children)
   is still whole-block.
2. **Comments** are not part of the content snapshot, so they never appear in the
   content diff.
3. **Formatting shows as duplication** — a re-formatted word renders as the old
   version (red, struck-through) followed by the new (green), rather than a single
   "modified" highlight. (No dedicated "modified" diff variant exists yet.)
4. **False-positive safety** rests on the serializer emitting the same attribute
   set for unchanged content; `direction` (auto-computed) is excluded and `style`
   is order-normalized to prevent spurious diffs.

Verified by an independent 14-case unit test against `diffEditorStates`
(including an identical-doc false-positive guard and a clean-neighbors guard) —
all pass; typecheck + lint clean. Also verified **live**: (1) the new diff runs
on a real 17-block persisted doc (tables/embeds/layouts) with zero false
positives; (2) committed-old vs fixed on that real document's state → 5/5
previously-invisible ops (bold, color, alignment, table cell background, indent)
now produce marks where old produced 0; (3) driving the **real browser editor**
(type → bold via Cmd+B) and opening "Show changes" renders every word as red
(old, struck) + green (bold) — a change that produced an empty diff before the
fix.

## Sources

- Slash menu: `doc-editor/.../plugins/SlashMenuPlugin/index.js`
- Toolbar / inline format: `doc-editor/.../plugins/ToolbarPlugin/`, `FloatingTextFormatToolbar/`
- Table menu: `doc-editor/.../plugins/TableCellActionMenuPlugin/`
- Custom commands: `doc-editor/.../constants/commands/customLexicalCommands.js`
- Programmatic ops: `.claude/skills/ai-doc/SKILL.md` (content engine `content-builder.ts`)
- Diff algorithm: `rtc-server/src/history/doc-diff.ts`; wiring: `versions.service.ts`, `internal.controller.ts` (`diffAgainst`); UI: `frontend/src/features/workspace/history/DocHistoryView.tsx` (`?diff=true`)
- Diff rendering: `doc-editor/.../nodes/DiffMarkNode/index.ts`; colors: `editors/docEditor/editor.scss` (`.ds-de-content-added` / `.ds-de-content-removed`)
