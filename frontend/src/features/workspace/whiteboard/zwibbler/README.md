# Zwibbler → tldraw conversion

Backward compatibility for legacy Toddle workbooks drawn with
[Zwibbler](https://zwibbler.com). A Zwibbler document is a flat array of nodes
(`PageNode`, `SvgNode`, `TextNode`, `BrushNode`, …) each carrying an affine transform
matrix; `zwibblerToTldraw.ts` converts that array into tldraw shapes + assets.

## Files

| File | Role |
| --- | --- |
| `zwibblerToTldraw.ts` | The converter. Pure data transform — no editor dependency; callers create the returned shapes/assets on any tldraw editor. |
| `fixture.json` | Real workbook sample (1 page, 3 tinted SVG clipart shapes, 1 text node, 10 brush strokes) used by the preview page. |
| `ZwibblerPreviewPage.tsx` | Dev-only harness at `/zwibbler-preview` (DEV builds only): renders the fixture on a local, non-synced canvas. |

## Node mapping

| Zwibbler node | tldraw shape | Notes |
| --- | --- | --- |
| `PageNode` | *(none)* | The whiteboard is freeform — pages contribute only an x-offset so they flow left-to-right without overlapping. No bounded frames. |
| `SvgNode` (clipart) | `image` | The original workbook SVG is fetched once per unique (url, tint) and materialized as a data-URI asset. Zwibbler's `fillMode: "custom"` repaints path fills with `fillStyle`; we do the same textually — exact silhouette, exact color. |
| `SvgNode` (fetch failed) | `geo` | Fallback: nearest native geo shape by asset name (hexagon, heart, cloud, star, …), fill snapped to the palette. |
| `TextNode` | `text` | Nearest size bucket × the shape's `scale` prop reproduces the exact rendered size. Alignment mapped; auto-resize respected. |
| `BrushNode` | `draw` | Stays a real pen stroke (editable as ink), points run through the node's transform then `compressLegacySegments`. |
| anything else | — | Collected in `skipped` (returned to the caller), never silently dropped. The preview page logs them to the console. |

Transforms: the `[a, b, c, d, tx, ty]` matrix is decomposed into position + `rotation` +
scale baked into dimensions. Colors for text/draw/geo snap to the nearest color of the
whiteboard theme palette (`WHITEBOARD_SOLIDS`) — tldraw has no arbitrary-hex style;
image-backed clipart keeps its exact hex via the tinted asset.

## Usage

```ts
const { shapes, assets, skipped } = await zwibblerToTldraw(nodes);
if (assets.length) editor.createAssets(assets);
editor.createShapes(shapes);
```

Async because SVG clipart is fetched (network). Safe to call with any node array —
unknown node types end up in `skipped`.

## Verifying changes

Run the dev server and open `/zwibbler-preview`. To try another document, replace
`fixture.json` (a Zwibbler doc's `nodes` array as saved by the old workbook editor).

## Not yet handled

- Node types beyond the four above (e.g. lines/arrows/images if old workbooks contain
  them) — they surface in `skipped`; add mappings as real documents demand.
- Batch migration: nothing writes converted boards back to storage yet. The intended
  flow (convert on first open of a legacy workbook, then persist to Yjs) is future work.
