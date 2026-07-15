# Whiteboard (WHITEBOARD page type)

Collaborative infinite-canvas page type built on [tldraw](https://tldraw.dev) 5.x, synced
over the app's existing rtc-server/Yjs stack — same plumbing as DOC and SHEET, only the
client surface differs. Decision background and library evaluation:
`docs/whiteboard-library-comparison.md`; integration plan and E2E contract:
`docs/whiteboard-integration.md`.

> **Licensing:** we run tldraw unlicensed for now, which shows its watermark. A business
> license is required before shipping to production.

## Files

| File | Role |
| --- | --- |
| `WhiteboardEditor.tsx` | Production entry, lazy-loaded from `PageView.tsx`. Resolves the RTC token, then mounts the canvas. Viewer role ⇒ read-only canvas. |
| `useYjsTldrawStore.ts` | The tldraw ⇄ Yjs binding (hand-rolled; tldraw has no first-party Yjs support). See below. |
| `whiteboardTheme.ts` | Toddle brand palette mapped onto tldraw's named colors + Avenir Next World as the default text font. |
| `zwibbler/` | Backward compatibility with legacy Zwibbler workbooks — converter, fixture, dev preview page. See `zwibbler/README.md`. |
| `WhiteboardBenchPage.tsx` | Dev-only perf harness (`/whiteboard-bench?n=1000`, DEV builds only). Methodology + results: `docs/whiteboard-library-comparison.md` §Performance. |

## Sync architecture (`useYjsTldrawStore.ts`)

One `Y.Map<TLRecord>` under the `'tldraw'` key, keyed by record id (per-record LWW — the
same granularity tldraw's own sync service uses), over the shared
`WebsocketProvider(RTC_WS_URL, docId, …)`:

- **tldraw → Yjs**: store listener (`source: 'user', scope: 'document'`) mirrors
  added/updated/removed records into the map inside a transaction tagged with a local
  origin, so our own writes are ignored by the remote observer.
- **Yjs → tldraw**: map observer applies remote changes via `store.mergeRemoteChanges`
  (doesn't touch local undo history).
- **Presence** (cursors, selections) rides Yjs awareness, not the document:
  `createPresenceStateDerivation` publishes our presence record to awareness; other
  clients' presence records are mirrored into the store. Nothing presence-related is
  persisted.
- **First sync**: if the server doc has records, they replace the fresh store's defaults
  (dropping the local default page so boards don't grow duplicates); an empty server doc
  keeps the local defaults, which sync on first edit.
- **Token refresh**: y-websocket re-reads `params` on every reconnect, so a mutable ref
  keeps long-lived sessions authed without tearing down the doc (same pattern as sheets).

Undo/redo is tldraw's built-in local history (not Yjs-scoped — undoing won't revert
collaborators' work, but the scoping isn't shared-UndoManager precise either; known
trade-off, see integration doc).

## Theme & font (`whiteboardTheme.ts`)

- Same 13 color *names* as tldraw's default palette, brand hex values — so the synced
  store schema is untouched and boards stay compatible with default-themed clients.
- The `sans` font (our default for new text, set via `DefaultFontStyle` on mount) is
  **Avenir Next World**, using the same ttf files ds-web's global `@font-face` declares.
  Registering them as theme faces makes tldraw preload them and embed them in PNG/SVG
  exports.
- `WHITEBOARD_SOLIDS` exports the light-mode solids for nearest-color matching in the
  Zwibbler converter.

## Integration points outside this folder

| Layer | File |
| --- | --- |
| DB enum `WHITEBOARD` | `packages/database/prisma/schema.prisma` |
| Backend DTO | `backend/src/documents/dto.ts`, `documents.service.ts` |
| Frontend type union | `frontend/src/types/api.ts` |
| New-page menu entry | `frontend/src/features/workspace/pageTypes.tsx` |
| Editor mount | `frontend/src/features/workspace/content/PageView.tsx` (lazy) |
| Dev routes | `frontend/src/routes.tsx` (`/zwibbler-preview`, `/whiteboard-bench`) |
