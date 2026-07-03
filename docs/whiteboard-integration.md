# Whiteboard page type — integration plan

## Status

Both branches implement v1 and pass the same 14-step E2E verification against the live dev stack
(2 editors + 1 viewer, real browser): create from menu, draw, live two-way sync, remote cursors,
persistence across reload, read-only viewer, DOC/SHEET regression.

- `feat/whiteboard-excalidraw` — `@excalidraw/excalidraw` 0.18.1 + `y-excalidraw` 2.0.12.
  Fonts load from Excalidraw's CDN fallback — self-host via `EXCALIDRAW_ASSET_PATH` before
  production. y-excalidraw's peer range says ^0.17 (audited: its API usage is 0.18-safe).
- `feat/whiteboard-tldraw` — `tldraw` 5.2.2 + a hand-rolled ~180-line Yjs binding
  (`useYjsTldrawStore.ts`; no maintained community binding exists — tldraw pushes its own sync
  service). Runs unlicensed with a "Get a license for production" watermark; a business license
  (~$6k/yr) is required to ship.

Not yet exercised on either: undo/redo under concurrency, export, copy/paste, offline merge,
dark theme, large boards. Undo/redo parity gap: Excalidraw branch shares a `Y.UndoManager`
(undo only your own ops); tldraw branch uses tldraw's built-in local history.

## Goal

Add a collaborative whiteboard/drawing page type to the workspace. Build it first with
**Excalidraw** (MIT), then build a parity branch with **tldraw** (commercial, ~$6k/yr business
license) and compare. The feature checklist below is the contract both branches implement, so the
comparison is apples-to-apples.

- Branch 1: `feat/whiteboard-excalidraw`
- Branch 2: `feat/whiteboard-tldraw` (same checklist, editor component swapped)

## Architecture (shared by both branches)

A whiteboard is a third `Document` type alongside `DOC` and `SHEET`. Content lives entirely in
Yjs, synced through the existing `rtc-server`; the backend only stores page metadata. This mirrors
how sheets work today — `rtc-server` sync and persistence need **no changes**.

Integration points:

| Layer | Change | File |
| --- | --- | --- |
| DB schema | Add `WHITEBOARD` to `DocumentType` enum + migration | `packages/database/prisma/schema.prisma` |
| Backend | Add to `DOCUMENT_TYPES` | `backend/src/documents/dto.ts` |
| Frontend types | Extend `DocumentType` union | `frontend/src/types/api.ts` |
| Page registry | Add entry (label/description/icon) — auto-populates create menus | `frontend/src/features/workspace/pageTypes.tsx` |
| Editor | New `WhiteboardEditor.tsx`, lazy-loaded | `frontend/src/features/workspace/whiteboard/` |
| Page view | Branch on `openDoc.type === 'WHITEBOARD'` | `frontend/src/features/workspace/content/PageView.tsx` |
| History (later) | Whiteboard case for version previews | `rtc-server/src/history/versions.service.ts` |

Editor wiring mirrors `SheetEditor.tsx`: `useRtcToken(docId)` → `new Y.Doc()` →
`WebsocketProvider(RTC_WS_URL, docId, ydoc, { params: { token } })` → bind canvas elements to Yjs
shared types.

Sync binding:

- **Excalidraw**: `y-excalidraw` (community lib) binds the elements array to a `Y.Array`, with
  awareness (remote cursors/selections) and shared undo/redo. Small library — review it; vendor
  into `packages/` if we need fixes. Must work with pinned `yjs@13.6.27` (pnpm override forces it).
- **tldraw**: no first-party Yjs support (tldraw pushes its own sync server). Use the
  store ↔ Yjs binding pattern from tldraw's yjs example, adapted to our provider. This is the
  main integration-risk delta between the branches — note the effort difference in the comparison.

## Feature checklist (v1 — both branches must cover)

Page lifecycle (free via existing plumbing):

- [ ] Create whiteboard from the new-page menu; rename, move, delete like any page
- [ ] Opens via `?doc=<docId>`, lazy-loaded bundle (canvas lib loads only when a whiteboard opens)

Canvas:

- [ ] Freehand draw, shapes (rect/ellipse/diamond), arrows/connectors, lines, text
- [ ] Sticky-note-style elements
- [ ] Select/move/resize/rotate, multi-select, group
- [ ] Infinite canvas: pan, zoom, zoom-to-fit
- [ ] Undo/redo (scoped to local user's changes, not collaborators')
- [ ] Copy/paste within and between whiteboards
- [ ] Export selection/canvas to PNG and SVG

Collaboration:

- [ ] Element changes sync live between clients
- [ ] Remote cursors + selection highlights via Yjs awareness
- [ ] Offline edits merge on reconnect (CRDT — verify, don't assume)
- [ ] Token refresh without dropping the live connection (mutable `params.token` ref, as in sheets)
- [ ] Viewer role: read-only canvas (rtc-server already drops viewer writes; the UI must also
      disable editing so viewers don't see their edits silently reverted)

Workspace fit:

- [ ] Dark/light theme follows app theme (`themeStore`)
- [ ] Sidebar icon for the whiteboard page type
- [ ] Empty state: blank canvas, no seeding needed (unlike sheet's seeded rows)

## Explicitly out of scope for v1

- Version history previews (`versions.service.ts` case) — whiteboards fall through to empty
  previews; add in v2
- Image/file assets (deferred — see Decisions)
- Mermaid-to-diagram, shape libraries, embeds, laser pointer / presentation mode — evaluate in v2
- Search/indexing of canvas text

## Decisions

1. **Assets (images): deferred to v2.** Canvas element data lives in Yjs, but image binaries
   shouldn't. Both libs reference files by id; we'd need an upload endpoint + storage and garbage
   collection. v1 ships without image insert; storage design is a follow-up.
2. **No feature flag.** Work stays on feature branches until we decide to merge; the `PAGE_TYPES`
   entry is the single toggle point if we ever need one.

## Open questions

1. **Doc size limits.** Very large boards → large Yjs docs. `rtc-server` persistence coalesces
   updates, but we should sanity-check snapshot size with a few hundred elements.

## Comparison (E2E-verified where noted; rest pending)

| Criterion | Excalidraw | tldraw |
| --- | --- | --- |
| Checklist coverage / gaps | v1 verified 14/14 | v1 verified 14/14 |
| Integration effort (Yjs binding) | `y-excalidraw` off the shelf; small community lib, stale peer range — vendor if it breaks | hand-rolled binding (~180 lines), we own sync + presence code; no lib risk, more surface to maintain |
| Bundle size added (lazy chunk) | TBD (measure on build) | TBD (measure on build) |
| Perf with large boards (500+ elements) | TBD | TBD |
| Collab correctness (verified) | live 2-way sync, presence cursors, persistence, viewer write-block | same |
| Undo/redo | shared Y.UndoManager (own-ops only) | tldraw local history (not Yjs-scoped) |
| Look & feel / UX polish | hand-drawn aesthetic, minimal chrome | noticeably richer default UI: style panel, page menu, snapping; rich text in shapes |
| Extensibility (custom shapes for toddle content) | effectively fork-only | first-class custom shape/tool API |
| License / cost | MIT, free | watermark without key; ~$6k/yr business license for production |
