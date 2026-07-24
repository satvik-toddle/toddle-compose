# Zwibbler → excalidraw conversion

Backward compatibility for legacy Toddle workbooks drawn with
[Zwibbler](https://zwibbler.com). A Zwibbler document is a flat array of nodes
(`PageNode`, `SvgNode`, `TextNode`, `BrushNode`, …) each carrying an affine transform
matrix; the converter turns that array into Excalidraw element skeletons + binary files.

Code lives in `frontend/src/features/workspace/whiteboard/zwibbler/`.

## Files

| File | Role |
| --- | --- |
| `zwibblerToExcalidraw.ts` | The converter. Pure data transform — no editor dependency; callers feed the returned skeletons through `convertToExcalidrawElements` and add the files on any Excalidraw instance. |
| `fixture.json` | Real workbook sample (1 page, 3 tinted SVG clipart shapes, 1 text node, 10 brush strokes) used by the preview page. |
| `ZwibblerPreviewPage.tsx` | Dev-only harness at `/zwibbler-preview` (DEV builds only): renders the fixture on a local, non-synced canvas. |

## Node mapping

| Zwibbler node | Excalidraw element | Notes |
| --- | --- | --- |
| `PageNode` | *(none)* | The whiteboard is freeform — pages contribute only an x-offset so they flow left-to-right without overlapping. No bounded frames. |
| `SvgNode` (clipart) | `image` | The original workbook SVG is fetched once per unique (url, tint) and materialized as a data-URI `BinaryFileData`. Zwibbler's `fillMode: "custom"` repaints path fills with `fillStyle`; we do the same textually — exact silhouette, exact color. |
| `SvgNode` (fetch failed) | `rectangle` | Fallback: a plain rectangle of the fill color at the same box. No native shape/palette snapping (unlike the earlier tldraw converter). |
| `TextNode` | `text` | Font size is the workbook size × the matrix scale, applied directly — Excalidraw takes arbitrary sizes, so no bucketing. Font is `Nunito` (workbooks used Nunito Sans); alignment mapped. |
| `BrushNode` | `line` | A dense polyline through the node's transform. Freedraw isn't in the skeleton API, so strokes come in as a static line (visually equivalent), not editable ink. |
| anything else | — | Collected in `skipped` (returned to the caller), never silently dropped. The preview page logs them to the console. |

Transforms: the `[a, b, c, d, tx, ty]` matrix is decomposed into position + `angle` +
scale baked into dimensions. Excalidraw accepts arbitrary hex colors, so text/line
strokes and fills keep their **exact** workbook values — no palette snapping anywhere.

## Usage

```ts
const { elements, files, skipped } = await zwibblerToExcalidraw(nodes);
if (files.length) api.addFiles(files);
api.updateScene({ elements: convertToExcalidrawElements(elements) });
```

Async because SVG clipart is fetched (network). Safe to call with any node array —
unknown node types end up in `skipped`.

## Verifying changes

Run the dev server and open `/zwibbler-preview`. To try another document, replace
`fixture.json` (a Zwibbler doc's `nodes` array as saved by the old workbook editor).

## Not yet handled

- Node types beyond the four above (e.g. lines/arrows/images if old workbooks contain
  them) — they surface in `skipped`; add mappings as real documents demand.
- Brush strokes import as static lines, not editable freedraw ink.
- Batch migration: nothing writes converted boards back to storage yet. The intended
  flow (convert on first open of a legacy workbook, then persist to Yjs) is future work.
