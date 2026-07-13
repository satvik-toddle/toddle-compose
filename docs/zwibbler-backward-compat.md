# Zwibbler backward compatibility — tldraw vs Excalidraw (verified)

Findings from building and running **both** converters against the same real workbook
fixture. This supersedes the speculative Excalidraw notes in
`whiteboard-library-comparison.md` §5 — every row below was exercised in a browser on
`feat/whiteboard-compare`, not predicted.

## See it yourself

Dev server → **`/zwibbler-preview`** (dev-only route). The header switches libraries:

- `/zwibbler-preview?lib=tldraw` — `zwibblerToTldraw.ts`
- `/zwibbler-preview?lib=excalidraw` — `zwibblerToExcalidraw.ts`

Same fixture (`zwibbler-fixture.json`: 1 page, 3 tinted SVG clipart shapes, 1 text node,
10 brush strokes), two canvases. Unknown node types are collected and logged to the
console (`skipped`), never silently dropped — same contract in both converters.

## Conversion mapping, side by side

| Zwibbler concept | tldraw | Excalidraw |
| --- | --- | --- |
| Affine matrix `[a,b,c,d,tx,ty]` | ✅ x/y + `rotation` + scale baked into dims | ✅ same decomposition, `angle` prop |
| Bounded `PageNode`s | ✅ x-offsets on the open canvas | ✅ identical treatment |
| `SvgNode` clipart + "custom" fill repaint | ✅ fetch once per (url, tint), re-tint textually, data-URI image asset | ✅ identical approach via `addFiles` + image element |
| Clipart fallback when the SVG fetch fails | ✅ nearest native geo shape (hexagon, heart, cloud, star…) | ⚠️ plain rectangle in the fill color (only rect/ellipse/diamond exist) |
| `TextNode` | ✅ nearest size bucket × `scale` prop → exact rendered size | ✅ **exact** `fontSize` in px, no workaround needed |
| Workbook font (Nunito Sans) | ⚠️ `sans` default (Shantell/inter-ish stack, not Nunito) | ✅ bundles **Nunito** — matches the original workbooks |
| `BrushNode` freehand ink | ✅ native `draw` shape (`compressLegacySegments`) — stays a real pen stroke, editable with the pen tool | ⚠️ `line` polyline — pixel-identical render, but selects/edits as a many-point line, not ink (`freedraw` isn't exposed by `convertToExcalidrawElements`; hand-building full freedraw elements means maintaining Excalidraw's internal schema) |
| Arbitrary hex colors | ⚠️ snaps to the 13-color brand palette (`whiteboardTheme.ts`) — visible loss on user-picked colors | ✅ exact hex, zero loss |
| Stroke widths | ⚠️ four discrete sizes (s/m/l/xl) | ✅ continuous px |
| Custom nodes (audio) | 🔧 custom shape API, clear path | ⚠️ `renderEmbeddable` hack, degrades as custom types grow |

## Pros and cons

### Excalidraw

**Pros**

- **Exact color fidelity** — arbitrary hex for stroke/fill/tint survives conversion untouched.
- **Continuous values** — exact font sizes and stroke widths, no bucket-snapping anywhere.
- **Nunito is bundled** — converted text renders in the same face the workbooks were
  authored in.
- **MIT, free** — no license cost on the conversion investment.

**Cons**

- Brush strokes arrive as polylines, not pen ink: visually identical, second-class to edit.
- Thin shape vocabulary (rect/ellipse/diamond) → weaker fetch-failure fallback for clipart.
- No custom-font API (canvas-rendered, fixed bundled set) — Nunito is lucky, Avenir Next is
  impossible without forking.
- Custom node types (audio) have no first-class path.

### tldraw

**Pros**

- **Converted ink stays ink** — brush strokes become native `draw` shapes users keep editing
  with the pen tool.
- **Rich native shape set** — real hexagon/heart/cloud/star fallbacks when a workbook asset
  is dead.
- Purpose-built conversion helpers (`compressLegacySegments`, asset records, v5 theme API
  that remaps its palette to Toddle brand colors).
- Custom shapes are first-class → the only clear path to full Zwibbler parity (audio nodes,
  custom tools).

**Cons**

- **Lossy colors** — everything snaps to 13 named colors; arbitrary workbook hexes shift.
- Discrete size buckets — text needs the `scale` workaround; stroke widths snap to four steps.
- Watermarked without a paid business license (~$6k/yr) — the converter investment is behind
  a paywall in production.

### A wash

- Tinted SVG clipart: both use the same fetch-and-retint data-URI image approach; converted
  images stay images (not editable vectors) in both.
- Matrix/page/geometry handling: identical fidelity.
- The fixture converts fully on both — nothing skipped, visually near-indistinguishable
  side by side.

## Bottom line

- **Fidelity of old content:** Excalidraw converts more faithfully (exact colors, exact
  sizes, original font).
- **Editability of converted content + long-term Zwibbler parity:** tldraw (real ink,
  custom shapes for audio nodes), at the cost of palette snapping and the license fee.
