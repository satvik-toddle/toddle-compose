# Whiteboard library comparison — tldraw vs Excalidraw

A decision doc for the whiteboard page type. Both candidates are fully integrated on parity
branches against the same 14-step E2E contract (see `whiteboard-integration.md`):

- `feat/whiteboard-excalidraw` — `@excalidraw/excalidraw` 0.18.1 + `y-excalidraw` 2.0.12
- `feat/whiteboard-tldraw` — `tldraw` 5.2.2 + hand-rolled Yjs binding (`useYjsTldrawStore.ts`)

Every claim below is against these exact versions, verified from the installed packages or
exercised on the branches — not from marketing pages.

## How to read this

A limitation only counts as a limitation if there is no workaround. Each item is rated:

| Rating | Meaning |
| --- | --- |
| ✅ | Out of the box |
| 🔧 | Buildable on a documented, supported extension API — expected work, not a hack |
| ⚠️ | Workaround exists but with real caveats (fragile, constrained, or fights the library) |
| ❌ | No viable path short of forking the library |

---

## 1. At a glance

| | tldraw 5.2 | Excalidraw 0.18 |
| --- | --- | --- |
| License | Proprietary SDK; watermark unlicensed; business license ~$6k/yr to ship | MIT, free |
| Rendering model | Each shape is a React/DOM component on the canvas | Single `<canvas>` bitmap (rough.js hand-drawn style) |
| Aesthetic | Polished product UI (Figma-adjacent) | Sketchy / hand-drawn by default; ✅ tunable to clean — roughness 0, solid fill, normal font via `appState` defaults |
| Extensibility story | First-class: custom shapes, tools, full UI replacement | Slot-based UI tweaks; element set is fixed |
| Collab story | No first-party Yjs; we own a ~180-line binding (verified) | `y-excalidraw` community lib (verified) |
| Who it's for | Teams building a *product* on a canvas | Teams embedding a *sketch pad* |

The rendering model is the root of most differences below. Because tldraw shapes are DOM/React,
anything React can render can live on the canvas and stays interactive. Excalidraw paints pixels
onto one canvas, so its element vocabulary is hardcoded into the renderer.

---

## 2. Core canvas features

| Feature | tldraw | Excalidraw | Notes |
| --- | --- | --- | --- |
| Freehand draw | ✅ | ✅ | Both pressure-aware; tldraw's ink is smoothed, Excalidraw's is sketchy |
| Basic shapes | ✅ rect, ellipse, diamond, triangle, hexagon, star, heart, cloud, oval, trapezoid, pentagon, octagon, arrow-boxes, x-box, check-box | ✅ rect, ellipse, diamond only | Matters for Zwibbler clipart (§5) |
| Arrows / connectors | ✅ elbow + curved, snapping, bound to shapes | ✅ bound arrows | Parity for basic use |
| Text | ✅ rich text (bold/italic/lists/links, tiptap-based), per-shape `scale` for exact sizing | ✅ plain text, fixed font-size steps | Rich text is tldraw-only. Both default to a handwritten font; both include normal fonts and can default to them (tldraw `DefaultFontStyle` → `sans`, Excalidraw `currentItemFontFamily`) |
| Text inside shapes | ✅ labels on any geo shape | ✅ container-bound text | Parity |
| Sticky notes | ✅ note shape | ⚠️ styled rectangle + text (no dedicated note) | Cosmetic gap only |
| Frames | ✅ | ✅ (`frame` element) | Both can section a board |
| Select / move / resize / rotate / group | ✅ | ✅ | Parity |
| Snapping & alignment guides | ✅ | ⚠️ align actions exist; live snapping is weaker | |
| Infinite canvas, pan/zoom/zoom-to-fit | ✅ | ✅ | Parity; both verified on our branches |
| Minimap | ✅ built-in navigation panel | ❌ none (would be custom canvas overlay) | |
| Undo / redo | ✅ local history | ✅ | Collab scoping differs — see §6 |
| Copy/paste, duplicate | ✅ | ✅ | Cross-board paste verified on both |
| Export PNG / SVG | ✅ | ✅ (+ `.excalidraw` JSON) | tldraw also has `.tldr` JSON |
| Eraser | ✅ | ✅ | Both scrub whole elements |
| Laser pointer | ✅ | ✅ | Both built in |
| Zoom-independent UI (handles, labels) | ✅ | ✅ | |
| Dark mode | ✅ `colorScheme` prop, follows our `themeStore` | ✅ `theme` prop | Both wired on our branches |
| Mermaid → diagram | ❌ (no OOTB; would be custom import) | ✅ `@excalidraw/mermaid-to-excalidraw` | Rare Excalidraw win |
| Keyboard shortcuts | ✅ + remappable via UI overrides | ✅ fixed set | |

**Takeaway:** for vanilla drawing the two are near-parity. tldraw's extras (rich text, more shape
primitives, minimap, snapping) are conveniences; Excalidraw's Mermaid import is its one unique
core feature.

---

## 3. Customization & extensibility

This is where the libraries genuinely diverge, and it's the section that decides Zwibbler parity.

### Custom nodes (the audio-node case)

Zwibbler let us define custom node types — e.g. the audio node: a playable widget on the canvas
that pans/zooms with the page, is selectable, movable, resizable, and persists in the document.

| | tldraw | Excalidraw |
| --- | --- | --- |
| Custom node types | 🔧 **first-class `ShapeUtil` API.** Define a shape type with arbitrary typed props, render it as a real React component (`HTMLContainer`) on the canvas. Selection, move, resize, rotate, persistence, undo, and camera transforms are handled by the framework. An `<audio>` player, a video, a poll widget, a live iframe — anything React renders works and stays interactive. | ⚠️ **no custom element API.** The element union (`rectangle`, `diamond`, `ellipse`, `arrow`, `line`, `freedraw`, `text`, `image`, `frame`, `embeddable`, `iframe`…) is hardcoded into the renderer. Workaround: the `embeddable` element + `renderEmbeddable(element, appState) => JSX` lets us render custom React inside an embed rectangle — an audio node is *possible* this way. Caveats: the data model is a URL string on a rectangle (custom props must be smuggled through the link), no style-panel integration, embed-style click-to-activate interaction, and it fights the collab layer (y-excalidraw syncs element data, not our smuggled state). |

Verdict: both have *a* path, but tldraw's is a supported API designed for exactly this; Excalidraw's
is a hack we would own forever. If custom nodes multiply (audio today; video, worksheets, math,
stickers tomorrow) the Excalidraw path degrades from ⚠️ toward fork-only.

### Custom tools & toolbar

| | tldraw | Excalidraw |
| --- | --- | --- |
| Add a new tool (e.g. "insert audio", stamp tool) | 🔧 `StateNode`-based tool API; tools get pointer/keyboard state machines and appear in the toolbar via UI overrides | ❌ toolbar tool set is fixed (`ToolType` is a closed union). Workaround is external buttons that call `excalidrawAPI` imperatively — outside the canvas interaction model (no drag-to-place, no tool state) |
| Replace / restyle the toolbar (Zwibbler-style bottom bar with brushes + eraser) | 🔧 every UI region is swappable via the `components` prop (Toolbar, StylePanel, ContextMenu, menus…), or `hideUi` + build all chrome on the editor API | ⚠️ slot-based only: `renderTopRightUI`, `MainMenu`, `Footer`, `WelcomeScreen`, custom `Sidebar`, and `UIOptions` to *hide* built-ins. The core toolbar itself cannot be replaced or reordered. A fully custom bottom bar means hiding what's hideable and floating our own UI over the canvas, driving `excalidrawAPI.setActiveTool` — partially viable, permanently constrained |
| Custom tool icons / skeuomorphic brush bar (today's Zwibbler UI: pen, eraser, highlighter artwork) | 🔧 two supported levels: swap any built-in icon SVG via `assetUrls` overrides, or set `components.Toolbar` to our own React bar (or `null` + own overlay) — a pixel-perfect port of the existing Toddle brush bar is just React calling `editor.setCurrentTool(...)` | ⚠️ no icon override API; `UIOptions.tools` can only hide the image tool. The known workaround is CSS-hiding the native toolbar by class name (unsupported, breaks on upgrades) and overlaying our own bar driving `setActiveTool` |
| Custom style panel (our own color/size pickers) | 🔧 `components.StylePanel` replacement; styles are a typed API | ⚠️ same slot limits; possible via overlay + API |
| Color palette | ✅ done — `themes` prop, brand palette shipped on our branch (`whiteboardTheme.ts`) | ⚠️ element colors are arbitrary hex (good), but the *picker UI's* curated palette isn't a supported API |
| Context menu | 🔧 replaceable | ⚠️ not replaceable; hide + custom overlay |
| Localization | 🔧 full translation override | ✅ `langCode` (48+ locales) | |

### Programmatic control

| | tldraw | Excalidraw |
| --- | --- | --- |
| Editor API surface | ✅ rich imperative + reactive API (`editor.*`: create/update shapes, camera, selection, history, viewport queries — what our Zwibbler converter drives) | ⚠️ coarser `excalidrawAPI` (`updateScene`, `scrollToContent`, `setActiveTool`…) — full-scene updates rather than granular ops |

---

## 4. Media on canvas

Zwibbler rendered images, videos, and our custom audio on the canvas. Ratings assume the asset
*storage* problem (upload endpoint + GC) is ours in both cases — it's deferred to v2 either way.

| Media | tldraw | Excalidraw |
| --- | --- | --- |
| Images | ✅ image shape + asset pipeline (upload/resolve hooks, external or data-URI src). Our converter already ships tinted SVG data-URI assets through it | ✅ image element (binary `files` map; y-excalidraw doesn't sync binaries — we'd sync file data ourselves) |
| Video | ✅ native video shape (plays on canvas) | ⚠️ no video element; YouTube/Vimeo via `embeddable` iframe only — no file-based video |
| Audio | 🔧 custom shape (§3) — clean fit | ⚠️ `renderEmbeddable` hack (§3) |
| Iframe embeds (YouTube, forms…) | ✅ embed shapes + custom embed defs | ✅ `embeddable` + `validateEmbeddable` allowlist |
| SVG clipart with recoloring | ✅ proven — the Zwibbler converter re-tints SVGs and renders exact silhouettes | ✅ same data-URI approach would work (images are images) |

---

## 5. Backward compatibility — Zwibbler

The legacy estate: Toddle workbooks are Zwibbler documents — flat node arrays with affine
matrices, bounded pages, URL-referenced SVG clipart with a fill-repaint mode, freehand brush
strokes, text nodes, arbitrary hex colors and continuous sizes, plus our custom nodes (audio).

### Status: a working converter exists — on the tldraw branch

`frontend/src/features/workspace/whiteboard/zwibbler/zwibblerToTldraw.ts` (verified
end-to-end against a real workbook fixture on `/zwibbler-preview` — see that folder's
README for the module docs):

| Zwibbler concept | tldraw mapping | Status |
| --- | --- | --- |
| Affine matrix `[a,b,c,d,tx,ty]` | decomposed → `x/y`, `rotation` (`atan2(b,a)`), scale baked into dimensions | ✅ verified |
| Bounded `PageNode`s | freeform: pages contribute x-offsets on the infinite canvas (no frames) | ✅ verified |
| `SvgNode` clipart + "custom" fill repaint | fetch SVG once per (url, tint), re-tint fills textually, embed as data-URI image asset — exact silhouette + exact color; nearest geo shape (hexagon/heart/cloud/star…) as fetch-failure fallback | ✅ verified |
| Width-only persistence (no height) | height from SVG viewBox, or per-shape aspect table for the geo fallback | ✅ verified |
| `TextNode` (any font size, alignment, autosize) | text shape; nearest size bucket × `scale` prop → **exact** rendered size | ✅ verified |
| `BrushNode` freehand ink | points through matrix → draw shape via `compressLegacySegments` | ✅ verified |
| Arbitrary hex colors | nearest-color snap to the brand palette (`whiteboardTheme.ts` is the single source of truth) | ✅ verified |
| Unknown node types | collected + logged (`skipped`), never silently dropped | ✅ |
| Custom nodes (audio) | pending: needs the custom audio shape first (§3), then a converter case | 🔧 clear path |

### What the same converter costs on Excalidraw

Feasible for the basics, structurally worse in four places:

1. **Clipart**: only rect/ellipse/diamond primitives exist, so *every* clipart shape must go
   through the SVG-image path with **no geo fallback** when a fetch fails (dead workbook assets
   render as nothing). ⚠️
2. **Text fidelity**: no `scale` equivalent — font sizes snap to Excalidraw's fixed steps, so
   converted workbooks reflow. ⚠️
3. **Colors**: arbitrary hex is native — *better* fidelity than tldraw's palette snap. ✅ (the one
   place Excalidraw wins on conversion)
4. **Audio nodes**: land on the `renderEmbeddable` hack. ⚠️→❌ as custom types grow.

**Bottom line:** basic workbooks convert on either library; full Zwibbler parity (custom nodes,
custom toolbar) has a supported path only on tldraw. The converter investment made so far is
tldraw-specific.

---

## 6. Collaboration — multiple people on one whiteboard

Both branches pass the same live E2E: 2 editors + 1 viewer in real browsers — create, draw,
two-way live sync, remote cursors, persistence across reload, viewer write-block, DOC/SHEET
regression. Details:

| Aspect | tldraw | Excalidraw |
| --- | --- | --- |
| Transport / persistence | ✅ our existing `rtc-server` (Yjs), zero server changes | ✅ same |
| Binding | 🔧 hand-rolled ~180-line store↔Yjs binding (`useYjsTldrawStore.ts`). No maintained community lib (tldraw pushes its paid sync service). We own the code: no dependency risk, more surface to maintain | ✅ `y-excalidraw` 2.0.12 off the shelf. Small community lib, stale peer range (^0.17, audited 0.18-safe) — vendor it if it breaks |
| Live element sync | ✅ verified | ✅ verified |
| Remote cursors + selections (awareness) | ✅ verified (`InstancePresence` records from Yjs awareness) | ✅ verified |
| Read-only viewer | ✅ `isReadonly` instance state; rtc-server also drops viewer writes server-side | ✅ `viewModeEnabled`; same server backstop |
| Token refresh without dropping connection | ✅ mutable `params.token` (same pattern as sheets) | ✅ same |
| Undo/redo in collab | ⚠️ tldraw local history — not Yjs-scoped; behavior under heavy concurrency unverified | ✅ shared `Y.UndoManager` — undo affects *only your own ops* (the correct collab semantics) |
| Follow a user / presenter mode | ✅ `editor.startFollowingUser()` API built in | 🔧 `userToFollow`/`followedBy` appState primitives exist; camera-broadcast wiring is ours |
| Cursor chat / emotes | 🔧 buildable on awareness | 🔧 same |
| Comments on canvas | 🔧 custom shape + our data | ⚠️ no element type to hang them on (overlay hack) |
| Offline edit → reconnect merge | CRDT should handle it — **unverified on both** | same |
| Large boards (500+ elements) | DOM-per-shape with culling — measured, see §7 | single canvas — measured, see §7 |

**Takeaway:** collaboration is effectively a tie today — both verified against the same contract
on our own infra. The real differences are second-order: Excalidraw's undo semantics are more
correct for collab out of the box; tldraw has follow-mode built in and we own (rather than depend
on) the sync binding. The unverified items (offline merge, undo under concurrency, large boards)
should be exercised on whichever library wins before merge.

---

## 7. Performance (measured)

Measured on our actual branches, not synthetic demos. Harness: a dev-only
`/whiteboard-bench?n=<count>` route on each branch
(`frontend/src/features/workspace/whiteboard/WhiteboardBenchPage.tsx`) seeds *n* mixed elements
(⅓ solid rectangles, ⅓ ellipses, ⅓ text), measures the synchronous element-creation call, then
drives a 120-frame zoom oscillation via the camera API and records per-frame times. Runner:
headless Chrome (system Chrome, real wall-clock timing, 1600×1000 viewport) on an Apple-silicon
dev machine; values are the median of 2 runs (variance was small).

### Runtime (frame budget for 60 fps = 16.7 ms)

| Metric | tldraw | Excalidraw |
| --- | --- | --- |
| 1000 elements — avg / p95 frame | 8.6 ms / 10.2 ms | 8.3 ms / 9.3 ms |
| 2500 elements — avg / p95 frame | 10.4 ms / 12.3–15.5 ms | 8.3 ms / 9.2 ms |
| 2500 elements — JS heap | ~160 MB | ~52 MB |
| Create 2500 elements (sync call) | ~25 ms | ~2 ms† |

† Excalidraw's `updateScene` defers the real work to the next render, so its create number is
not directly comparable; neither library blocks meaningfully on seeding.

**Reading:** both libraries hold 60 fps comfortably at 2500 elements. The expected trade of the
rendering models shows up clearly: tldraw (DOM per shape) degrades mildly with element count and
uses ~3× the memory; Excalidraw (single canvas) is flat on both. Extrapolating, very large boards
(10k+) will hurt tldraw first — but 2500 elements is already several times larger than a typical
workbook page, and tldraw's viewport culling helps when zoomed in (this benchmark's zoomed-out
frames are its worst case).

### Bundle size (gzip, lazy chunks loaded when a whiteboard opens)

| | tldraw branch | Excalidraw branch |
| --- | --- | --- |
| Canvas library chunk | 520 KB JS + 15 KB CSS | 165 KB JS |
| Editor + Yjs binding chunks | ~2 KB + 27 KB (y-websocket) | ~4 KB + 29 KB (y-websocket) |
| **Total at whiteboard open** | **~565 KB** | **~205 KB** |

Both branches have identical main-entry chunks (~65 KB gz) — neither leaks the canvas library
into the initial page load. Excalidraw's locale (~9 KB, on demand) and Mermaid chunks load only
when used; fonts load on demand for both. **Excalidraw is ~2.7× lighter** on the wire.

### Not covered by this benchmark

Text-editing re-layout, selection-drag with many selected shapes, collab broadcast overhead under
concurrent editing, 10k+ element boards, and low-end devices. If perf becomes the deciding factor,
extend the same harness — both bench pages take `?n=` and emit machine-readable results.

## 8. License, cost, maintenance

| | tldraw | Excalidraw |
| --- | --- | --- |
| License | Proprietary SDK license. Free with "Get a license for production" watermark; business license **~$6k/yr** to ship without it | MIT — free, forever |
| Vendor risk | Single company (tldraw Inc). Active releases; breaking majors happen (we're on v5) | Open source, very active repo backed by excalidraw.com; slower API evolution |
| Our dependency surface | Yjs binding is *our* code (no third-party collab lib) | `y-excalidraw` community lib (vendor-if-broken plan) |
| Fonts/assets | self-hostable | CDN fallback — must self-host via `EXCALIDRAW_ASSET_PATH` before production |
| Bundle size (lazy chunk) | ~565 KB gz (measured, §7) | ~205 KB gz (measured, §7) |

The honest cost framing: $6k/yr against engineering time. A single quarter of maintaining a forked
or workaround-laden Excalidraw customization layer costs more than several years of the tldraw
license.

---

## 9. Pros & cons

### tldraw

**Pros**
- Custom shapes/tools/UI are the SDK's core design — the entire Zwibbler-parity roadmap (audio
  nodes, custom toolbar, mixed media) is supported API, not hacks
- React/DOM shapes: interactive widgets on canvas, rich text, native video
- Richer defaults: style panel, snapping, minimap, follow mode, more primitives
- Zwibbler converter + brand theming already built and verified on this branch
- Collab binding is our own small, audited code — no dependency risk

**Cons**
- ~$6k/yr license (watermark until purchased)
- Proprietary — vendor dependence for the canvas core
- We maintain the Yjs binding ourselves (~180 lines, but ours)
- Undo/redo not collab-scoped out of the box (buildable via Yjs history if needed)

### Excalidraw

**Pros**
- MIT, zero license cost
- Charming hand-drawn aesthetic (if that fits the product)
- Correct collab undo semantics via shared `Y.UndoManager`
- Arbitrary per-element colors (best conversion color fidelity)
- Mermaid-to-diagram import

**Cons**
- No custom element API — the audio node and future custom content ride on the `renderEmbeddable`
  hack, which degrades toward fork-only as custom types grow
- Toolbar/tool set is a closed union — a Zwibbler-style custom toolbar can only be approximated
- No native video; plain text only (no rich text); fewer shape primitives
- Community collab lib with a stale peer range (vendoring contingency)
- Weaker conversion fidelity for legacy workbooks (no geo fallback, font-size snapping)

---

## 10. Suggested demo video walkthrough

To pair with this doc, record each branch doing the same script:

1. Create a whiteboard page, draw shapes/ink/text, show the style panel and palette
   (tldraw: brand colors; Excalidraw: default UI)
2. Second browser: live sync, remote cursors, viewer in read-only
3. tldraw branch only: `/zwibbler-preview` — a real legacy workbook converted (freeform pages,
   tinted clipart, ink, text)
4. tldraw branch only: theme toggle (dark palette)
5. Call out the watermark on tldraw (until licensed)

---

## 11. Recommendation

**tldraw**, driven by §3 and §5: it is the only candidate with a supported path to Zwibbler
parity (custom interactive nodes, custom toolbar, media), and the converter + theming work is
already done there. Excalidraw is the right pick only if the whiteboard's scope is permanently
"simple free sketch canvas" and the license fee is unacceptable — its limitations have
workarounds today, but they compound with every custom feature we add.

Either way, before merge: exercise offline merge, undo under concurrency, and a 500+ element
board; and (tldraw) budget the business license. Bundle size and large-board perf are now measured in §7.
