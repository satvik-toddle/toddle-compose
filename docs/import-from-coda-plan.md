# Import from Coda — plan (parked)

Status: **parked** (2026-07-22). Requirements agreed verbally; implementation not started.

## Requirements

- New doc action **"Import from Coda"** (alongside "Copy to Coda" / "Open in Coda").
- Clicking opens a modal with two inputs:
  - **Coda page link** (URL of the page to import).
  - **Destination** — the same scope selector used by Copy to Coda; the scope supplies the
    encrypted Coda token pool and validates that the link is within scope.
- On submit the modal shows a **spinner and waits synchronously** — explicitly **no job queue**.
- The backend fetches the page content from Coda and the flow **overrides the current doc's
  content** with it (destructive replace, not merge).

## Building blocks already proven

- **Coda content fetch**: the page export API works end-to-end —
  `POST /docs/{docId}/pages/{pageId}/export {outputFormat:"html"}` → poll the export status →
  download (gzipped HTML). Verified live during the table-width work. Needs a `CodaClient`
  method with read-rate-limiting (begin/poll/download).
- **URL → page resolution within a scope**: `ScopeValidationService.validateDestinationUrl`
  already resolves and scope-checks a Coda URL to a `codaPageId` (used by enqueue overrides).
- **Tokens**: `CodaCredentialsService.getTokenPool(scopeId)` decrypts per-scope tokens
  server-side; tokens must never reach the client.

## Architecture decision to make (open)

Two candidate paths for HTML → doc content:

1. **Client-side conversion (leaning this way).** Backend endpoint only proxies the fetch:
   `POST /documents/:docId/import-from-coda { scopeId, url }` → returns sanitized HTML.
   The frontend converts HTML → Lexical using the **0.48 doc-editor** (full `importDOM`,
   including `colgroup` widths → `colWidths`) and replaces content through the **live Yjs
   binding** — the same client-side mutation model version-history restore uses (there is no
   rtc restore endpoint; restores are applied from the client over the collab connection).
   - Pros: best fidelity (0.48 importers), no new rtc machinery, collab-safe by construction.
   - Cons: requires the doc to be open (or an offline provider session like DocHistoryView
     spins up); needs an imperative "replace content from HTML" hook exposed by
     `@toddle-edu/ds-doc-editor` (prebuilt/symlinked — may need a package change + rebuild).
2. **Server-side conversion.** New rtc internal endpoint: HTML → `$generateNodesFromDOM`
   (lexical **0.45** + vendor bundle) → replace root in the doc's Y.Doc → persist + broadcast.
   - Pros: works with the doc closed; one place to sanitize.
   - Cons: 0.45 importers (no colWidths etc. — worse fidelity), new write-path machinery in
     rtc persistence, must handle live-client convergence carefully.

Check before deciding: how the **ai-doc** skill (`.claude/skills/ai-doc/SKILL.md`) writes rich
content (headings/tables/etc.) into docs — it may already contain the write-path machinery
(not yet read).

## Sketch (whichever path wins)

- **Backend**: `POST /documents/:docId/import-from-coda` (workspace EDIT+ and doc writable):
  validate scope + URL → decrypt token pool → export page HTML from Coda (sync, with request
  timeout) → path 1: return HTML / path 2: call rtc internal import → 200.
- **Frontend**: menu item in `DocActions` (and sidebar `pageMenuItems` if the doc-open
  constraint allows), `ImportFromCodaModal` (scope `SelectDropdown` + URL `TextInput` +
  submitting spinner + inline error), `useImportFromCoda` mutation — no polling.
- **Sanitization**: reverse-map Coda export chrome (grid `data-coda-*`, caption "Table N",
  header `th` widths → colWidths) before insertion.
- **Safety**: confirm destructive overwrite in the modal copy; consider auto-snapshotting the
  doc (a history version) right before the replace so the import is undoable via restore.

## Verification plan

- Unit: HTML reverse-sanitizer; endpoint auth/validation.
- Live: import a real Coda page (tables incl. custom column widths, images, lists) into a doc
  under `TC Migration Test`-scoped destination; verify content, then verify a version-history
  restore can undo the import.
