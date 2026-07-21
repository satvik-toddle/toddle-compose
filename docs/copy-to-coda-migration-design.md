# Copy to Coda — Migration Design

Migrate a toddle-compose document subtree into [Coda](https://coda.io) via the Coda API. A user picks a doc, reviews its subtree in a modal, and copies it into a scoped Coda destination. Migrations run as durable background jobs, tracked on a Migrations page.

> Status: design settled, not yet built. UI build parked until designs are provided; backend/rtc first.

---

## 1. Goals & non-goals

**Goals**
- Copy a DOC and its sub-docs into Coda, preserving hierarchy.
- Re-migration is safe and predictable (no accidental clobbering; duplicates only by choice).
- Scalable and resilient: async, durable, rate-limit-aware, resumable.
- Scoped: migrations may only write into admin-configured Coda locations.

**Non-goals (v1)**
- SHEET docs (filtered out — no HTML projection today).
- Two-way sync / pull-from-Coda.
- Rewriting internal doc-to-doc links to Coda URLs (deferred).
- Per-workspace Coda OAuth (single shared server token for v1).

---

## 2. User flow

1. From a doc's actions menu (`DocActions.tsx`) or a sidebar row menu (`pageMenuItems.tsx`), the user clicks **Copy to Coda**. Requires **editor role or above**.
2. A modal opens showing the clicked doc + its `parentId` subtree as an **editable preview tree**:
   - **SHEET** docs are filtered out; their DOC descendants default to the nearest DOC ancestor.
   - The user can **drag-rearrange** nodes; the arranged hierarchy is what gets migrated.
   - Each row shows a **destination cell** (prefilled Coda URL if previously migrated, else "New page") with a per-row **edit** to override/retarget, and an **include** checkbox.
   - A **destination-root selector** chooses which scope root to migrate under (see §4).
   - A top-level **"Create new copies / Update existing"** toggle bulk-applies saved mappings.
3. The user clicks **Start Copy**.
4. A **toast** confirms the migration started; the app **auto-navigates to the Migrations page**, which lists all runs with live status (GitHub-Actions style).

---

## 3. Document & content model (existing)

- Two Postgres DBs: **app** (`packages/database`, metadata/tree/auth) and **rtc** (`packages/rtc-database`, collaborative content). No cross-DB FK; `RtcDocument.id === Document.id`.
- Doc tree = self-referential `Document.parentId` (`@relation("DocumentTree")`), workspace-scoped, cascade-delete on subtree.
- Types: **`DOC`** and **`SHEET`** only. Content stored as a Yjs binary (`RtcDocument.yjsState`); no derived text column.
- Content export pipeline (in the symlinked `@toddle-edu/ds-doc-editor`):
  `yjsState` → `bytesToEditorStateJSON(bytes)` → `editorStateJsonToHtml(json)` → HTML.
  Image/embed nodes are materialized to absolute `BACKEND_PUBLIC_URL` URLs via the in-Yjs upload registry.

---

## 4. Scopes

Scopes define where migrations may write. Replaces the `CODA_DEFAULT_FOLDER_PATH` env var.

```
MigrationScope {                 // a "destination"
  id
  workspaceId             // required — scopes are strictly per-workspace
  codaRootUrl
  codaRootPageId          // resolved from the URL at save time
  codaDocId               // the Coda doc the root lives in
  label                   // destination name
  tokens: MigrationScopeToken[]   // 1..N encrypted Coda tokens (load-distribution pool)
  createdBy, createdAt, deletedAt
}
MigrationScopeToken { id, scopeId, codaTokenEnc, codaTokenHint, label }
```

- **Scopes are per-workspace only** (no common/global scopes — dropped to avoid cross-tenant reach).
- A scope root is **either a whole Coda doc** (`codaRootPageId = null` → migrate as top-level pages; any page in the doc is in-scope; no root to protect) **or a specific page** (nest under it; descendants in-scope; root not overridable). The Coda user owning each token must be shared as **Editor** on that doc/folder in Coda (tokens aren't doc-scoped, H10).
- Managed via **Admin → Migrations** as a **table of destinations** (CRUD). Adding a destination takes: name, Coda URL, and one or more **Coda tokens** — resolved/validated together at save (token must have write access to the doc).
- A destination's **multiple tokens** let the pacer distribute write load (H1); tokens are encrypted at rest and shown masked.
- On save, resolve the URL to `(codaDocId, codaRootPageId)` and validate the token has write access.
- **Validation of a destination URL:** resolve to a Coda page id, walk its ancestor chain; it must be a descendant of an effective scope root — else reject with a **visible row error** (never silent discard). The scope root itself is **not overridable**; any other page inside the scope is.
- Multiple roots are supported; the modal's destination-root selector lists the effective set.
- v1 note: the test scope is a single page inside one Coda doc; ideal end state is one Coda doc per workspace ("complete workspace path").

---

## 5. Identity & idempotency

Default is **create new** (duplicate). A persisted mapping enables opt-in override via prefill.

```
MigrationMapping {
  sourceDocId
  scopeId               // destination root this mapping belongs to
  codaPageId
  codaPageUrl
  migratedVersion       // source Yjs version last migrated
  lastMigratedAt
  // keyed (sourceDocId, scopeId), latest-wins
}
```

- On re-run, each row's edit field is **prefilled** from its `(sourceDocId, selectedScopeId)` mapping. Switching the destination-root selector **recomputes** prefills (a mapping is root-specific).
- **Override** = wholesale content **replace** (no read-diff): `updatePageContent` replace mode.
- **Skip:** uncheck the row. **Retarget:** paste a new in-scope URL.
- **Stale prefill** (saved URL 404s / out of scope): fall back to **create new**, nested under the parent's *this-run* Coda page.
- Multiple past duplicate runs: mapping is **latest-wins**; older duplicates are orphaned.
- Orphaned Coda child (dropped from source subtree): **left in place and flagged**, not deleted.

---

## 6. Job engine

Durable, resumable, modeled on the rtc-server **compaction scheduler** (`OnApplicationBootstrap`, self-re-arming `unref`'d timer, resume-from-DB on boot, `$transaction` for state changes) — plus real claim/lease + per-item retry that compaction lacks.

```
MigrationJob     { id, workspaceId, scopeId, sourceRootDocId, status,
                   createdBy, createdAt, startedAt, finishedAt, counts }
MigrationJobItem { id, jobId, sourceDocId, plannedParentId, codaPageId?,
                   status, attempts, lastError, seq }
```

- **Job status:** queued / running / partial / succeeded / failed / canceled.
- **Item status:** pending / running / succeeded / failed / skipped.
- **Enqueue** snapshots the explicit selected doc list, the **user-arranged hierarchy** (explicit parent-per-node — *not* re-derived from `parentId` at run time), and each doc's Yjs version.
- **Idempotent create:** persist `item.codaPageId` immediately after creation; on resume, check it before creating (prevents crash-duplicates).
- **Parent resolution order** per item: this-run result (parent item's persisted `codaPageId`) → saved mapping → scope root. Resolved from the DB so it survives a restart.
- **Restart / fault tolerance:** all state is durable in Postgres. Claim is an atomic conditional `UPDATE` on the lease (D9) so no double-processing across a restart or a second instance. On boot the worker requeues `RUNNING` items with an expired lease and re-drives `QUEUED`/`RUNNING` jobs. `codaPageId` is persisted **immediately after `createPage`, before `awaitMutation`**, so a crash mid-poll never duplicates on resume (and wholesale `replace` is idempotent). A half-migrated subtree resumes and completes correctly.
- **Cancel** (stop processing remaining items) and **retry-failed-only** (re-claim failed items) exposed on the Migrations page.
- Content extraction runs in **rtc-server** (headless-Lexical worker pool); the backend orchestrates + calls Coda. A new rtc **internal endpoint** returns HTML for `(docId, version)`; called via `RtcInternalClient`.

---

## 7. Rate limiting

- **Per-destination token pool:** each destination stores 1..N Coda tokens (encrypted, in the DB); the limiter keys a ≤5/10s bucket **per token** and distributes writes least-loaded across a destination's pool (N tokens ≈ N× throughput, since Coda's cap is per-user). Concurrent jobs to different destinations use different token sets.
- **Adaptive backoff:** honor `429` + `Retry-After` / rate-limit response headers rather than hardcoding limits; retry up to a max, then mark the item failed (job → partial).
- Wholesale override (no read-diff) minimizes API calls.

---

## 8. Permissions & security

- **Who may migrate:** **workspace** editor role or above (viewers and below blocked). Grant-only guests (a doc-level EDIT grant but no workspace role) **cannot** migrate — gate on workspace role, not effective-doc role.
- **Sub-doc access:** filter out sub-docs the user can't read; **re-check at run time** (grants can be revoked between enqueue and run).
- **Governance:** migrated content leaves toddle's access control; show a warning that it becomes visible to anyone with Coda access.
- **Tokens:** stored **per-destination in the DB, encrypted at rest** (AES-256-GCM, key from `MIGRATION_ENC_KEY`), never returned to the client (masked `••••last4`). A destination holds 1..N tokens; each is validated for write-access to the destination doc at save. Env `CODA_API_TOKEN` is a dev fallback only.
- Secrets (session cookies, data dumps) removed from the repo; ensure `.env` and scratch artifacts stay gitignored.

---

## 9. Content fidelity

- **DOC only.** Strip comment/diff/AI marks (`MarkNode`, `DiffMarkNode`, `InlineCommentNode`, `SmartPlaceholderNode`).
- Images/embeds require a **public** `BACKEND_PUBLIC_URL` (Coda fetches URLs at import; localhost won't work — image E2E needs a deployed/tunnelled backend).
- Lossy blocks (merged table cells, layout columns, collapsibles, embeds) map best-effort; large docs chunk their content.
- Internal doc-to-doc links (two-pass rewrite) deferred.

---

## 10. Notifications & Migrations page

- Start → **toast** + **auto-navigate** to `/w/:workspaceId/migrations`.
- Migrations page lists runs with status, per-item progress, failures, and retry/cancel — **GitHub-Actions-style**. This is the durable status source (no separate notification system in v1).
- **Visibility:** workspace-scoped (a workspace's runs) by default; **org-wide only when opened in the admin console**; **viewers and below cannot see it**. Runs expose destination Coda URLs, so gate accordingly.

---

## 11. Edge cases & mitigations

Baseline set (from design review). The adversarial pass (§12) augments this.

| Area | Edge case | Mitigation |
|---|---|---|
| Identity | Crash after create, before mark-done → duplicate | Persist `codaPageId` immediately; check on resume |
| Identity | Stale/404 prefill URL | Fall back to create-new under this-run parent |
| Identity | Multiple duplicate runs | Latest-wins mapping; orphans left+flagged |
| Scope | URL out of scope | Reject with visible row error |
| Scope | Scope root override attempt | Disallowed server-side |
| Content | SHEET with DOC children | SHEETs filtered; children re-parent to nearest DOC ancestor; user can rearrange |
| Content | Images unreachable in dev | Public `BACKEND_PUBLIC_URL` at deploy |
| Rate | Concurrent jobs share token bucket | Global-per-token limiter |
| Perms | Sub-doc the user can't read | Filter + runtime re-check |
| Lifecycle | Source edited/deleted mid-job | Snapshot at enqueue; skip+flag deleted items |

---

## 12. Adversarial edge-case pass

Independent multi-lens review. Severity: 🔴 blocker · 🟠 major · 🟡 minor. Status: **accept** (fix during build) · **decided** (policy resolved) · **dissolved** (no longer applies).

### 12.1 Permissions / scope / security
| # | Sev | Issue | Resolution | Status |
|---|---|---|---|---|
| P1 | 🔴 | Common-scope CRUD gated on "workspace admin" = cross-tenant escalation | Common scopes removed entirely; scopes are per-workspace | dissolved |
| P2 | 🟠 | No permission re-check between enqueue and job run (job has no user identity) | Persist enqueuer `userId`; re-resolve per-doc role immediately before each read; abort per-doc on downgrade | accept |
| P3 | 🟠 | Common scope + "override any in-scope page" + shared token → cross-tenant tamper | Removed with common scopes | dissolved |
| P4 | 🟠 | Ancestor validation spoofable if it string-matches the URL | Resolve URL → `pageId` via Coda API, assert same `docId` as scope root, walk **real** Coda ancestry; ignore URL string | accept |
| P5 | 🟠 | Naive subtree walk pulls cross-workspace docs via stray `parentId` | Reuse `collectSubtreeDocIds` (workspace-anchored CTE, `documents.service.ts:884-908`); never hand-roll | accept |
| P6 | 🟠 | Run history / destination URLs are an info-disclosure surface | Workspace-scoped visibility; org-wide only in admin console; viewers excluded | decided |
| P7 | 🟠 | Scope deleted/narrowed after validation (TOCTOU) | Persist resolved `pageId` + `scopeId` on job; re-validate containment at execution; FK `onDelete: Restrict` / soft-delete | accept |
| P8a | 🟡 | Elevate-only role model → "viewer-only sub-docs" can't be excluded | Unenforceable by design; don't design around it | acknowledged |
| P8b | 🟡 | Grant-only guest vs the editor gate | Gate on **workspace** editor role; grant-only guests can't migrate | decided |

### 12.2 Content extraction / fidelity
| # | Sev | Issue | Resolution | Status |
|---|---|---|---|---|
| C1 | 🔴 | `RtcDocument.yjsState` is a stale/`null` snapshot (content = snapshot + `doc_updates` tail; `doc-state.service.ts:113-144`) | Replay the tail (mirror `bindState`) or force a flush before extracting; never feed raw `yjsState` alone | accept |
| C2 | 🔴 | `editorStateJsonToHtml` needs a browser DOM; no jsdom in backend/rtc → empty HTML | Run the HTML step in the browser or inject jsdom globals; note it does NOT co-locate with the DOM-free `bytesToEditorStateJSON` | accept |
| C3 | 🟠 | Non-`.zip` file embeds export as `<iframe>` (binaries vanish); branch is by URL extension | Branch on `__mimeType`; emit a labeled download `<a>` for attachments | accept |
| C4 | 🟠 | `uploadId` with no registry entry → `src="undefined"` / empty media | Detect unresolved uploads; drop or emit placeholder; never emit `src="undefined"` | accept |
| C5 | 🟠 | `SmartPlaceholderNode` exports an empty span → visible label lost | `exportDOM` writes `textContent` = placeholder/resolved value | accept |
| C6 | 🟠 | Process-global `EmbedMediaStore`/`LastValidSrcMap` leak across a batch export | Resolve src from per-doc JSON; clear singletons between docs | accept |
| C7 | 🟠 | `DiffMarkNode` has no `exportDOM` → deleted content can leak; no strip hook | Guarantee diff state isn't persisted, or add a strippable marker and drop `removed` variants | accept |
| C8 | 🟡 | Comment/inline-comment marks wrap real text | Strip must **unwrap** (keep children), not delete the subtree | accept |
| C9 | 🟡 | Collapsible `open="false"` imports as open; title carries a stray `<svg>` | Omit `open` when false; give title an `exportDOM` emitting text only | accept |
| C10 | 🟡 | `img width="inherit"`; YouTube iframe has no text fallback; headings lack anchor ids | Best-effort cosmetics; YouTube fallback to watch URL | accept |

### 12.3 Data integrity / concurrency / job queue
| # | Sev | Issue | Resolution | Status |
|---|---|---|---|---|
| D1 | 🔴 | `RtcDocument.version` is a flush counter, not content version → skips changed docs | Use **head seq** (`getHeadSeq`) as the content cursor; preserved across compaction | accept |
| D2 | 🟠 | Version captured at enqueue but bytes pushed at execution (TOCTOU) | **Point-in-time sync:** capture head seq at ENQUEUE (`enqueuedSeq`); the worker reconstructs the doc UP TO that seq and pushes that; `migratedSeq = enqueuedSeq` so recorded == pushed. Syncs the Start-Copy version, not run-time. Caveat: an old seq relies on update-log granularity (compaction may snap to a nearby boundary for very old seqs — negligible for minutes). Phase 4d | accept |
| D3 | 🟠 | `previewAtSeq` reads the persisted log, misses the warm Y.Doc tail | Force flush/checkpoint before the read (add internal endpoint) or record head actually read | accept |
| D4 | 🟠 | Filtering a SHEET mid-tree orphans its DOC descendants to the scope root | Re-anchor surviving descendants to nearest non-filtered ancestor | accept |
| D5 | 🟡 | `cold-load-seed` inflates head on mere open → false "changed" | Exclude cold-load-seed-only history / gate on a content hash | accept |
| D6 | 🟠 | Two jobs over overlapping subtrees → duplicate pages + mapping clobber + untracked orphan | Uniqueness/advisory lock on `(sourceDocId, scopeId)` claimed before the Coda create | accept |
| D7 | 🟠 | Source deleted mid-job → pushes empty doc as success + dangling mapping | FK-cascade mappings to `Document`; cancel in-flight items in `remove()`; guard `head===0`/missing source → skip, don't push blank | accept |
| D8 | 🟠 | Scope/workspace deleted while a job targets it | Define job↔scope lifecycle: transactionally cancel its jobs; worker treats "row not found" as quiet abandon | accept |
| D9 | 🔴 | "Model the lease on compaction" — compaction has **no lease** (bare `setTimeout` + INSERT) | Implement a real lease: conditional atomic UPDATE / `SELECT … FOR UPDATE SKIP LOCKED` | accept |
| D10 | 🟠 | Two-DB non-transactional enqueue → inconsistent snapshot / partial job on crash | Persist only doc-id list + arranged hierarchy at enqueue; capture cursor at execution | accept |

### 12.4 Coda API reality-check
> Sourcing note: `coda.io/developers` and `community.coda.io` now redirect to `docs.superhuman.com` / `connect.superhuman.com` (Coda acquired by Grammarly/Superhuman) — same API/forum, new hosts.

| # | Sev | Issue (verified against live API docs) | Resolution | Status |
|---|---|---|---|---|
| H1 | 🔴 | Content-write limit is **5 req / 10s, per-USER across ALL docs** (not per-token/per-doc); generic writes 10/6s, reads 100/6s. Steady ceiling ≈ 1 write / 2s | **Per-destination token pool** (1..N encrypted tokens/destination in DB); pacer keys a 5/10s bucket per token, distributes least-loaded → **N tokens ≈ N× throughput**. Concurrent jobs to different destinations use different pools. ETA surfaced | accept |
| H2 | 🔴 | Mutations are **async**: return `202` + `requestId`; content import is queued with **size-correlated propagation delay** (seconds→45s+ in big docs) | Poll `getMutationStatus` to `completed` before descending to children; never assume ordering from 202s; the engine is a paced, mutation-gated queue, **not** a synchronous depth-first loop | accept |
| H3 | 🟠 | **No move/reparent endpoint** — `parentPageId` is create-only; only delete + metadata updates exist | Keep it simple: no move/delete — on reparent just **create a new duplicate** under the new parent (consistent with default-duplicate); old page left in place. Supersedes M3 | accept |
| H4 | 🟠 | HTML import is a **lossy subset** — tables render badly (headers ignored, merged cells lost), callouts/`<aside>`, quote+bullet combos mangle; no published tag whitelist | **Constrained HTML** (reuse `editorStateToHtml` + sanitizing/mapping pass) — least-lossy fast/scalable option; markdown is worse, native tables impossible. 7 inherent losses accepted. See §14 | accept |
| H5 | 🟠 | `resolveBrowserLink` may resolve to a **non-page** resource (doc/table/row) or the wrong page (table link → parent page) | Assert `resource.type === "page"` (ids look like `canvas-…`); canonicalize URL; reject/repair otherwise | accept |
| H6 | 🟠 | **No ancestor/path field** — `getPage` returns only the immediate `parent`; ancestor validation is N sequential reads | Iterative parent-walk with depth cap, null-parent termination, caching; can race a concurrent structural change | accept |
| H7 | 🟠 | Funneling everything into **one doc** hits doc-size limits — Free: 50 objects / 1000 rows; perf cliff ~100 pages; 325 MB auto-disables formulas/sync | Detect plan; hard-block on Free overflow; monitor object/size counts; consider spreading large migrations across docs | accept |
| H8 | 🟠 | **Per-request content size cap** (~85 KB observed on row edits; similar page ceiling) | Measure HTML payload; oversized page → create empty then stream body via successive `append` mutations (each async + rate-limited) | accept |
| H9 | 🟡 | Image-by-URL needs **permanent, public, no-auth** URLs and is reportedly flaky; unclear if Coda rehosts or hotlinks | Guarantee stable public asset URLs (no localhost/ngrok/expiring signed); verify rehost-vs-hotlink; post-import image check | accept |
| H10 | 🟡 | A Coda API token is **not doc-scoped** — it can write any doc its user can access; the "scope root" is app-side only | Enforce all scope/descendant checks in app logic; never rely on the token to prevent out-of-scope writes | accept |

**Net:** H1 + H2 are hard blockers that reshape the engine — the worker must be a **paced (≤5/10s), `getMutationStatus`-gated queue**, and the earlier "global-per-token limiter" is really **per-user** and ~30× slower than assumed (mitigated later via a token pool). H3 → reparent = create-duplicate (no move). H4 content-format alternative under investigation (§14).

---

## 13. Implementation TODO (living checklist)

Kept in sync as the build proceeds. `[ ]` todo · `[~]` in progress · `[x]` done.

### Decisions (all resolved)
- [x] Identity = persist per-`(sourceDocId, scopeId)` mapping + prefill; default duplicate; wholesale override
- [x] Scopes = per-workspace only (common/global dropped)
- [x] SHEET filtered out; DOC only; editable preview tree
- [x] Who may migrate = workspace editor+; grant-only guests blocked
- [x] Migrations page visibility = workspace / admin-console-org / viewers excluded
- [x] Notifications = start toast + auto-nav to GitHub-Actions-style Migrations page
- [x] Images rely on public `BACKEND_PUBLIC_URL`; rate-limit = global-per-token adaptive backoff

### Schema (Prisma) — done (app DB, applied via `db push`; repo doesn't use Prisma Migrate)
- [x] `MigrationScope` (per-workspace, resolved `codaDocId`/`codaRootPageId`, soft-delete P7/D8)
- [x] `MigrationMapping` keyed `(sourceDocId, scopeId)`, FK→`Document` `onDelete: Cascade` (D7), unique `(sourceDocId, scopeId)` (D6), `migratedSeq` (D1)
- [x] `MigrationJob` + `MigrationJobItem` with status/attempts/lastError/`codaPageId` (C3), `leasedBy`/`leasedUntil` (D9), enqueuer `createdById` (P2), `plannedParentDocId` (D10)
- [x] Enums `MigrationJobStatus` / `MigrationItemStatus`; back-relations on `Workspace`/`Document`
- [x] `MigrationScopeToken` — 1..N encrypted tokens per destination (load-distribution pool, H1)

### Backend (Coda + orchestration)
- [x] Boot-recovery + atomic `FOR UPDATE SKIP LOCKED` lease claim with a depth-first readiness gate (D9); `codaPageId` persisted in-tx before `awaitMutation`, idempotent resume (C3) — restart fault-tolerance, tested
- [x] **Phase 4d — enqueue-time (point-in-time) versioning:** enqueue captures `enqueuedSeq` (fail-closed) via rtc `GET /internal/docs/:docId/head-seq`; rtc `coda-html` honors `atSeq` (reconstruct UP TO it, clamped to snapshot baseline under compaction); worker passes it, records returned `headSeq` → `migratedSeq` (D2)
- [x] Coda API client (`backend/src/coda/`): native `fetch` + `AbortSignal.timeout`, adaptive 429/503 `Retry-After` backoff, per-token penalty + pooled reroute, 502 mapping
- [x] Content-write pacer: per-token ≤5/10s sliding-window buckets, least-loaded distribution across a destination's token pool, no cross-pool HOL block (H1)
- [x] Async mutation gate: `awaitMutation` polls `getMutationStatus` to `completed` w/ backoff before descending (H2)
- [x] Token cipher (AES-256-GCM, `MIGRATION_ENC_KEY`) + `CodaCredentialsService`; encrypt on save, decrypt at call time; never logged/returned; masked `last4`
- [x] Destinations API (list/create/patch/soft-delete; workspace-ADMIN + realm-admin org view); per-token resolve + access check at save (doc or page root); delete cancels in-flight jobs (D8)
- [x] `ScopeValidationService`: resolve → assert page/doc → same `docId` → depth-capped ancestor-walk (H5/H6); whole-doc vs page-root; root not overridable
- [x] Create-vs-override (override=`replacePageContent` in place, create=new page; H3); `(sourceDocId, scopeId)` advisory lock + latest-wins mapping (D6)
- [x] Payload chunking: oversized HTML → create + chunked `append` (`CODA_MAX_HTML_BYTES`, H8)
- [x] Worker: run-time permission re-check + source-existence/`isEmpty` skip (P2/D7); `documents.remove()` cancels in-flight items (D7); job finalization SUCCEEDED/PARTIAL/FAILED; retry-to-max
- [ ] Doc-size guards: detect plan, block Free overflow, monitor object/page/size counts (H7) — optional, deferred
- [x] Migration enqueue API (`POST /migration-scopes/:scopeId/jobs`): editor-gate (P8b), arranged-hierarchy item list (D10), per-doc read filter (C4/P5), DOC-only, override-URL validation, double-submit guard (#17)
- [x] Migrations status API (`GET /migration-jobs`, `:id`, cancel, retry-failed) with visibility gating (P6); retry keeps `codaPageId` for idempotency

### RTC server (content) — done
- [x] Internal endpoint `GET /internal/docs/:docId/coda-html` → `{html, headSeq, isEmpty}`; replay snapshot + tail (C1), force checkpoint before read (D3)
- [x] Head-seq cursor returned for the worker to record (D1/D2); `isEmpty` for null/empty/`head===0` (D7)
- [x] HTML conversion under jsdom in a per-request worker (C2), per-doc isolation (C6)
- [ ] cold-load-seed change-detection guard (D5) → belongs to Phase 4 (compares `migratedSeq`)

### Content pipeline (rtc sanitizer) — done as an HTML post-pass
- [x] Mark strip = unwrap comments (C8), drop DiffMark `removed` + unwrap `added` (C7), drop empty AI/comment-icon spans
- [x] Embeds: iframe/YouTube→link, file-embed→labeled link (C3, URL preserved), https-only images / no `src="undefined"` (C4), img dims (C10), per-request worker isolation (C6)
- [x] Collapsible→heading+body, layout grid→stacked, figure/figcaption strip, clean tables (§14)
- [x] Content transfer = **constrained HTML** sanitizer (H4, §14)
- [ ] (deferred to a doc-editor package rebuild — human decides) SmartPlaceholder resolved-value C5 (label already recovered); EmbedMediaNode mimetype-branch labeled download C3 (URL already preserved)
- [ ] Surface the 7 inherent-loss caveats in the migration UI (H4)
- [ ] Permanent public no-auth asset URLs; verify Coda rehost-vs-hotlink (H9)
- [ ] Large-doc chunking; empty/`null` doc → skip, never push blank

### Frontend (parked for designs)
- **Styling convention (mandatory):** inline **Tailwind objects** in the `RegisterPage` style (no SCSS/CSS modules); use `@toddle-edu/ds-web` components directly with `dsVersion="2.0"`; DS typography tokens (`text-heading-*`/`text-body*`/`text-label*`), never raw px or generic Tailwind sizes.
- [ ] Copy-to-Coda entry (`DocActions.tsx` / `pageMenuItems.tsx`)
- [ ] Modal: editable preview tree (drag-rearrange, SHEET filtered), destination-root selector, per-row prefill/edit, bulk toggle, virtualized + batched prefill lookup
- [ ] Migrations page (run list, per-item progress, retry/cancel), start toast + auto-nav
- [ ] Admin → Migrations scope CRUD

### Testing
- [ ] Coda API contract/integration tests: async `getMutationStatus` polling, ≤5/10s pacing, `resolveBrowserLink` type handling, doc-size/payload limits (H1–H8)
- [ ] **Phase 6 — full E2E through the real UI** (verify/run skills + Playwright): destination CRUD (URL + token(s), masked, validation); Copy-to-Coda modal (preview tree, SHEET filtered, prefill, override/create-new, bulk toggle, out-of-scope rejected); Start Copy → toast → Migrations page live statuses + retry/cancel; **real Coda writes** (hierarchy, override-in-place vs duplicate, images/tables/links render); edge cases (rate-limit pacing on a large tree, viewer blocked, deleted-source-mid-job). **Fault tolerance: kill the backend mid-job and confirm on restart the job resumes and completes with NO duplicate Coda pages and no lost/stuck items.** **Prereqs:** frontend built (Phase 5, needs designs) + a public `BACKEND_PUBLIC_URL` so Coda can fetch images.

---

## 14. Content-format investigation (H4)

**Decision: Constrained HTML.** Reuse the existing `editorStateToHtml` output plus a sanitizing/mapping pass, pushed via `createPage`/`updatePage` with `canvasContent.format = "html"` (1 API call/page). It is the fastest, most scalable, and — for our node set — the **least lossy** option. There is **no fast + scalable + lossless** path; Coda's import API caps fidelity (Coda's own docs: *"HTML and markdown can't perfectly represent all of the features of a Coda doc … may lose some information"*).

**Why not the alternatives:**
- **Markdown** (`format:"markdown"` is accepted) is *more* lossy: `@lexical/markdown` and the package's transformer kit have **no table/image/embed/column/collapsible transformers** (those nodes vanish at serialization), and Coda frequently **doesn't render markdown pipe tables as tables** on canvas. More work (exporter doesn't exist) for worse fidelity.
- **Native Coda objects** — **infeasible**: there is no `createTable` endpoint; `upsertRows` only adds rows to a *pre-existing* table, and canvas-inline table creation isn't exposed. Also brutal on the 5-writes/10s bucket.
- **Hybrid** (HTML prose + `upsertRows`) only works when the target doc **already contains** the table; doesn't generalize.

**Sanitizing/mapping pass over `editorStateToHtml` output:**
- Images → ensure `https` public `src` (drop non-public).
- Embeds / YouTube (`<iframe>`, unsupported) → replace with a plain `<a href>` so the URL survives.
- Multi-column layout (`display:grid`, ignored) → emit sequential heading-titled sections (or a plain table).
- Collapsibles (`<details>`, no importer) → heading + content.
- Tables → clean `<table><tbody>`; accept header/merge loss.
- Strip unsupported `<figure>/<figcaption>`.

**Inherent, unavoidable losses (any format) — set expectations in the UI:**
1. Merged cells (colspan/rowspan) — no Coda concept.
2. Real table headers (`<th>` ignored).
3. Interactive/real Coda tables — API can't create them; imported tables are static.
4. Multi-column layouts — flatten to stacked blocks.
5. Collapsibles — flatten to heading + body.
6. Media/YouTube embeds — preserve only the URL as a link.
7. Callouts — degrade to quote/plain text.

Sources: OpenAPI `coda.io/apis/v1/openapi.json` (`PageContentFormat = [html, markdown]`, no createTable); `docs.superhuman.com/developers/apis/v1`; connect.superhuman.com threads on HTML/markdown canvas limits. Local: `doc-editor/.../extract/editorStateToHtml.js:9`, `.../MarkdownTransformer.js:37`, `.../EmbedMediaNode.js:209`, `.../LayoutContainerNode.js:61`.

**Verified HTML-import-lossiness citations:**
- Coda staff (JonathanGoldman), API page-endpoints announcement: *"HTML and markdown can't perfectly represent all of the features of a Coda doc, so a round trip in either format may lose some information"* / *"best used for import or export scenarios, not page editing."* — [connect.superhuman.com/t/…/44103](https://connect.superhuman.com/t/more-powerful-page-endpoints-in-the-coda-api/44103)
- Coda dev (Eric Koleda): *"while Coda can display HTML as rich text, it doesn't have support for all HTML elements and features"* (iframe/figure/figcaption problematic) — [community.coda.io/t/…/44308](https://community.coda.io/t/html-type-in-the-canvas-display-errors-and-cleaning-the-code/44308)
- Maker report: *"Tables just look bad … doesn't respect table headers"*, images "a mess", `<aside>` callouts not interpreted, "Quotes with bulletpoints straight doesn't work" — [connect.superhuman.com/t/…/55898](https://connect.superhuman.com/t/html-limitations-on-api-uploads/55898)
- Markdown pipe tables don't render as grids on canvas — [connect.superhuman.com/t/…/51824](https://connect.superhuman.com/t/any-update-render-markdown-table-as-grid-or-table-in-canvas-column/51824)
- [ ] Content-fidelity fixtures (tables, columns, embeds, images, placeholders, collapsibles)
- [ ] Concurrency: overlapping jobs, crash/resume, delete-mid-job, lease contention
- [ ] Permissions: editor gate, run-time downgrade, cross-workspace subtree, visibility
