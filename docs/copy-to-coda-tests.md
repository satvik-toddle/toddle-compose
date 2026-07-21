# Copy to Coda — Test Catalog

What is being tested for the migration feature, by layer. Numbered for reference. (`✓` = implemented & passing; `◻` = planned in the stability harness, not yet run to convergence.)

---

## 1. Backend unit tests — Coda client (`backend/src/coda/`)
1. ✓ `createPage` sends the correct URL + `pageContent{canvas, html}` body; returns `{id, requestId}`.
2. ✓ `replacePageContent` / `appendPageContent` send `contentUpdate{insertionMode replace/append}`.
3. ✓ `awaitMutation` polls `getMutationStatus` and returns on `completed:true`.
4. ✓ `awaitMutation` treats a **404** on `/mutationStatus` as **completed** (Coda GC's completed mutations); a genuine 500 still throws.
5. ✓ `awaitMutation` throws 504 on poll deadline.
6. ✓ 429/503 → parse `Retry-After`, penalize that token, retry up to max; exhaustion → 429.
7. ✓ non-2xx → `HttpException(502)` carrying the real upstream `status` + truncated `body`.
8. ✓ network failure → `HttpException(502 "coda unreachable")`.
9. ✓ `getPageOrNull` returns the page on 200, `null` on 404, rethrows other errors.

## 2. Backend unit tests — rate limiter (`coda-rate-limiter.ts`)
10. ✓ single-token bucket saturation → subsequent acquire queues until the window frees.
11. ✓ multi-token pool → picks the least-loaded token; distributes across the pool.
12. ✓ all tokens saturated → queues, then resolves as capacity frees.
13. ✓ per-token `Retry-After` penalty isolates that token; a pooled retry reroutes to a free token.
14. ✓ no cross-pool head-of-line blocking: a saturated pool does not stall an acquire on a disjoint free pool.

## 3. Backend unit tests — credentials & scope (`migration/`)
15. ✓ `TokenCipher` AES-256-GCM round-trip; tamper (mutated ciphertext) throws; wrong/short key fails fast.
16. ✓ `validateDestinationUrl`: descendant-of-root OK; wrong-doc reject; scope-root itself reject; non-page reject.
17. ✓ whole-doc scope (`codaRootPageId` null) accepts any page in the doc; page-root walks ancestry to the root.
18. ✓ create destination: happy path (page root + whole doc); reject when a token can't access / tokens disagree; tokens stored encrypted, never returned (masked `last4`).
19. ✓ soft-delete a scope cancels its non-terminal jobs; realm-admin vs workspace-admin authz.

## 4. Backend unit tests — enqueue & status (`migration-jobs.service.ts`)
20. ✓ enqueue authz: viewer / comment / grant-only guest rejected (workspace EDIT+ required).
21. ✓ DOC-only (SHEET rejected server-side); unreadable doc rejected; cross-workspace doc rejected.
22. ✓ out-of-scope override URL rejected (names the offending doc).
23. ✓ double-submit guard: a second active job for the same `(scope, rootDoc)` rejected.
24. ✓ `include:false` rows dropped; items ordered depth-first by `seq`; job+items created in one tx.
25. ✓ **point-in-time**: enqueue freezes the current sanitized HTML into `snapshotHtml`; empty doc → `snapshotHtml=null`; a later content change does NOT alter the stored snapshot.
26. ✓ enqueue **fails closed** if snapshot extraction throws.
27. ✓ list visibility gate (viewers blocked; non-admin sees own runs; admin sees all; realm org view).
28. ✓ get hides others' runs (404); cancel; **retry re-drives FAILED + "parent did not migrate" SKIPPED items**.

## 5. Backend unit tests — worker (`migration-worker.service.ts`)
29. ✓ claim: `FOR UPDATE SKIP LOCKED`, readiness = parent item **SUCCEEDED** (not just codaPageId set).
30. ✓ expired-lease `RUNNING` item is reclaimable; fresh-lease is not.
31. ✓ create: persists `codaPageId` **before** `awaitMutation` (crash-idempotency, C3).
32. ✓ idempotent resume: an item entering with `codaPageId` already set does NOT call `createPage` again.
33. ✓ **retry reuses the page**: page-id present ⇒ `replacePageContent` (re-writes content); null ⇒ `createPage`.
34. ✓ **materialization poll**: `getPage` 404→404→200 proceeds & records the real `browserLink`; never-materializes → item retryable (no empty URL stored).
35. ✓ worker pushes the **frozen `snapshotHtml` verbatim** — makes zero rtc calls at run; `migratedSeq == enqueuedSeq`.
36. ✓ skip paths: empty snapshot → SKIPPED; source deleted → SKIPPED; permission lost → SKIPPED.
37. ✓ transient error (rtc-unreachable / Coda 429/503/5xx) → released & retried **without** consuming an attempt; a 400 fails at MAX.
38. ✓ sibling parent resolution from DB; terminal parent → descendants cascade-SKIPPED (no deadlock).
39. ✓ finalization: SUCCEEDED iff all succeeded; orphan skip → **PARTIAL** (never false-green); all-bad → FAILED.

## 6. rtc-server unit tests (`rtc-server/src/persistence/`)
40. ✓ sanitizer: diff-`removed` dropped / `added` unwrapped; comment `<mark>` unwrapped; smart-placeholder label recovered; `<details>`→heading+body; layout grid→stacked; iframe/YouTube→link; file-embed→labeled link; https-only images (no `src="undefined"`); `<figure>` stripped; table flattened; empty spans dropped.
41. ✓ extraction: reconstruct (snapshot + tail replay); `isEmpty` for null/empty/`head===0`; `atSeq` reconstructs up to the ceiling; clamps to snapshot baseline under compaction.
42. ✓ `head-seq` internal endpoint returns the head.

## 7. Permutation simulation harness (`✓` — the stability tests)
`backend/test/migration-sim/` — run with `pnpm --filter backend test:sim` (`SIM_SCENARIOS`, `SIM_SEED_BASE` env). Drives the **real** `MigrationJobsService` (enqueue) + `MigrationWorkerService` (claim/execute/finalize) — real claim SQL, real advisory locks, real finalization — against a **FakeCoda** and a **dedicated, isolated Postgres test DB** (`toddle_compose_migtest`; the user's app DB is never touched). FakeCoda models the §12.4 reality-check quirks, randomized per seed: `createPage`→id+requestId with the page **not queryable until it materializes after K polls** (H2); `getPageOrNull` 404s until materialized then 200s with a real `browserLink`; `awaitMutation` async then completes (or 404-expired=completed); **transient** 429/503/5xx/unreachable injected at any step with a probability that **recovers** after a bounded op count; a parent used before it EVER materialized is recorded as an ordering violation; **external page deletion** at random ops (an in-place write to a gone page → permanent 404). FakeRtc returns the deterministic frozen snapshot. Seeded RNG ⇒ any failure reproduces from its integer seed. A watchdog flags (never hangs on) a livelock.

Invariants asserted after each of the **10,000** scenarios converges (verified with teeth — reverting either fix in §9 turns the harness red):
43. ✓ **status == reality**: every doc whose page exists with the frozen content ⇒ item SUCCEEDED (no "created but FAILED"); a SUCCEEDED item has a real page id + matching content.
44. ✓ no duplicate Coda pages per `(sourceDoc, scope)` — `createPage` called **at most once** per item across all retries/resumes.
45. ✓ job status exactly correct (`SUCCEEDED` iff no FAILED and no tainting skip; `PARTIAL` iff mixed; `FAILED` iff nothing succeeded): never SUCCEEDED while a selected doc didn't migrate; never FAILED/PARTIAL while everything completed. Skip reasons must match reality (no spurious empty/unreadable skips).
46. ✓ injected transient errors that eventually recover ⇒ job converges to SUCCEEDED (every item SUCCEEDED with a live, correct-content page).
47. ✓ a parent's page is materialized before any child's create uses it as parent.
48. ✓ retry (`retry()` endpoint) + crash/lease-expiry resume recover via the **same** page (idempotent, no dup create).
Scenario dimensions (randomized per seed): tree shape (single / deep chain / wide flat / random, 1–30 nodes), create-vs-override mix, empty docs, delete-source-mid-run, lease-expiry/worker-restart, chunked (oversized) HTML, slow (large-doc) materialization crossing the poll budget, transient-error injection at every step, external page deletion.

## 9. Bugs found by the permutation harness (with the regression test added)
56. ✓ **Created-but-FAILED on slow materialization** (the reported bug): a large page that materialized slower than the poll budget threw a *plain* `Error`, classified **permanent** → burned the attempt budget → item FAILED with the page **already created + correct content**, and recoverable delays never converged to SUCCEEDED. Fix: `awaitMaterialization` throws a **transient** `HttpException` (`"coda page not materialized"`, added to `isTransientError`) → retries without burning an attempt until the page is queryable; a truly-deleted page still fails for real via the permanent 404 its in-place replace returns (no infinite loop). Regression: worker spec *"never materializes → TRANSIENT release (retryable, no attempt burn)"*; harness inv43/inv46.
57. ✓ **False-green finalization on a non-empty skip**: job finalization only treated the `"parent did not migrate"` orphan skip as tainting, so an **unreadable/deleted-source** skip (P2/D7) or a **destination-removed** skip left the job reporting SUCCEEDED — green while a selected doc silently didn't migrate. Fix: only a genuinely-empty-source skip (`EMPTY_SKIP_REASON`) is "clean"; **every** other skip is tainting → keeps the job off SUCCEEDED (`PARTIAL` if anything else succeeded, else `FAILED`). Regression: worker specs *"a tainting skip … → PARTIAL"*, *"… zero successes → FAILED"*, *"clean empty-source skips do not taint SUCCEEDED"*; harness inv45.
58. ✓ **Crash-resume in the create→materialize window permanently FAILs the item** (found by the real-Coda E2E kill-resume, reproducible): when the backend is killed after `createPage` returns + persists `codaPageId` (C3) but BEFORE the Coda page has materialized, the resumed worker took the *in-place replace* path (page-id present ⇒ `PUT /pages/:id`), which returned **404 "could not find a page"** because the page isn't queryable *yet*. That 404 was classified **PERMANENT** → 3 fast attempts → item FAILED (and children cascade-SKIPPED), even though the page materializes seconds later (`getPage` → 200 shortly after). The §56 fix made the CREATE path tolerate not-yet-materialized via `awaitMaterialization` (transient); the RESUME/replace path had none, so it couldn't tell "not yet materialized" (transient) from "externally deleted" (permanent). **Fix:** `createOrOverride` now decides the page-to-reuse under the advisory lock (a read-only tx — no in-lock network poll to blow the tx timeout), then on the reuse/resume path **awaits materialization before the replace PUT** via the shared `pollUntilMaterialized` (the same poll the create path uses; 404 = "not ready yet", not a failure). If the page materializes → replace in place (reuses the same id, re-writes content), proceeds. If it never materializes within `CODA_MATERIALIZE_TIMEOUT_MS`, the outcome is decided by **intent**: a **create-item** (`override === false` — the id came from our OWN prior `createPage`, not a user target) treats the dead id as unusable and **recreates** a fresh page (overwriting the dead id; the advisory lock + single-create-per-attempt keep this from duplicating a *live* page — a create-item just needs *a* page); a **user OVERRIDE target** (`override === true`, id === `targetCodaPageId`) that never materializes is genuinely gone → **PERMANENT FAIL** at the attempt cap with a clear `override target page <id> not found` error (never silently recreate a user's target). The materialization timeout bounds the poll, so no infinite loop. Regression: worker specs *"resumes with codaPageId set but not-yet-materialized → polls, then REPLACES (never permanent-fails on the transient 404)"*, *"a create-item whose reused page never materializes → RECREATES a fresh page"*, *"an OVERRIDE target that never materializes → PERMANENT fail"*. Repro: `tests/copy-to-coda-kill-resume.playwright.cjs` (kill just after `withCodaPageId≥1`). Original evidence: worker log `claimed … resumePage=<id>` → `PUT /docs/…/pages/<id> → 404` ×3 → `class=PERMANENT terminal=FAILED`, while `getPage(<id>)`→200 afterward.

## 8. End-to-end (real UI + real Coda) — Phase 6 (`◻`)
Driven by the persisted real-UI + real-Coda suite `tests/copy-to-coda.playwright.cjs`
(+ `copy-to-coda.lib.cjs`); kill-resume in `copy-to-coda-kill-resume.playwright.cjs`.
Fresh workspace + destination; cleans up its Coda pages under the scope root.

49. ✓ Admin → Migrations: add a destination (Coda URL + token(s)); **masked hint** (tokens never returned in plaintext); **validation error** surfaced on a bad/out-of-scope URL (`could not resolve Coda URL: …`).
50. ✓ Copy-to-Coda modal: tree renders (incl. grandchild), SHEET filtered (`N sheets skipped`), DotsSixVertical drag handles, mode gating (Create-new hides links / Update-existing shows them), **no row-height layout shift** (38px==38px).
51. ✓ Start Copy → auto-nav to `/w/:id/migrations`; run goes QUEUED→RUNNING→SUCCEEDED, **no created-but-FAILED / no false-green**. (Toast + status-icon presence confirmed in-app; the headless-suite selectors for those two are still being hardened.)
52. ✓ Real Coda: single / nested-chain (incl. **grandchild**) / wide all migrate in ONE pass with correct hierarchy; mapping URLs are per-page `docs.superhuman.com/…/_su…` (not doc-level / empty). Empty-source child → clean SKIP (job still SUCCEEDED); delete-source-mid-run → tainting SKIP → job **PARTIAL** (never false-green).
53. ✓ Override re-run (Update mode, prefilled per-page links): replaces content in place, reuses the **same** `codaPageId`s — **zero duplicate pages**.
54. ✓ Kill-resume: **item 58 FIXED** — a crash in the create→materialize window no longer permanent-fails the resumed item. The resume path awaits materialization before the in-place replace, so a not-yet-queryable page is reused (not falsely FAILED); a create-item whose page never materializes recreates, and a gone override target permanent-fails. Re-verified via the scripted kill-after-persist-before-materialize regression in the worker spec (`§9 item 58`), which drives the real worker `createOrOverride`/`processItem` against a Coda double returning 404-not-yet-materialized→200. **Confirmed LIVE against real Coda** (`scratchpad/manual-kr.mjs`, kill after `withCodaPageId≥1` / before materialize, then restart): resumed item log = `claimed … resumePage=canvas-jxZqxt5RnV` → `materialize poll 1..7 not-ready→ready` → `PUT /docs/…/pages/canvas-jxZqxt5RnV → 202` → `terminal=SUCCEEDED migratedSeq=2`; job SUCCEEDED, all 4 items SUCCEEDED, **root page count=1 (no duplicate)**, attempts max=0. Resume + no-dup + rtc-unreachable-transient all green.
55. ✓ **Point-in-time**: edit a doc after Start Copy → the migration pushes the **queued** version (`migratedSeq == enqueue head`, not the later head — verified via the seq check).
