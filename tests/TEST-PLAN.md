# Test plan — folders, documents (workspace RBAC) + RTC

Distilled from the POC's `tests/multiuser.cjs` and `tests/ui-flow.cjs`. Those were
full-stack Puppeteer flows (login → create doc → make public → two users converge →
presence avatars → reload persistence). Below is the same intent expressed as the
behaviours each layer must guarantee, so they can be covered by unit/integration
tests without driving a browser.

## 1. Folders (backend, workspace-scoped + soft delete)

- **create** in active workspace requires EDIT; folder gets `workspaceId` + `ownerId`.
- **create with parent**: parent must be live and in the same workspace (else 404).
- **list** returns only live folders of the workspace (no `deletedAt` rows).
- **read visibility**: any member with READ sees it; non-member/non-realm-admin → 403.
- **move**: cross-workspace parent rejected; self-parent → 400; cycle (into own
  subtree) → 400.
- **write gate** (rename/move/delete): creator OR workspace ADMIN; others → 403.
- **soft delete**: `remove` sets `deletedAt` on the folder **and its whole live
  subtree**; the rows vanish from every read but still exist in the DB.
- **purge**: `purgeSoftDeleted(30)` hard-deletes only rows with `deletedAt` older
  than 30 days; younger soft-deleted rows survive. (Driven daily by the cron.)

## 2. Documents (backend, workspace-scoped)

- **create**: PRIVATE by default; requires EDIT; `workspaceId` + `ownerId` set;
  optional `folderId` must be a live folder in the same workspace.
- **read**: owner, any workspace READ (members + workspace ADMIN + realm
  OWNER/MAINTAINER overlay), OR — when PUBLIC — any realm member. Otherwise 404
  (existence hidden).
- **write** (rename/move/visibility/delete): creator OR workspace ADMIN; else 403.
- **move**: target folder must be in the document's workspace.
- **visibility toggle**: PRIVATE↔PUBLIC flips read reach as above.

## 3. Authorization core (`AuthzService`) — pure ordering

- realm ladder OWNER > MAINTAINER > MEMBER; workspace ADMIN > EDIT > COMMENT > READ.
- `effectiveWorkspaceRole` = MAX(direct membership, realm overlay); realm
  OWNER/MAINTAINER → ADMIN on every workspace; no access → null.
- cross-realm workspace id → 404 (no leak).

## 4. RTC server (separate DB)

- **token verify** (JWKS, RS256): valid `editor`/`viewer` accepted; `denied`,
  wrong `iss`/`aud`, expired, or `docId` mismatch vs URL → handshake rejected.
- **internal API**: `X-Internal-Token` required (401 without); `init` upserts an
  `RtcDocument`; `versions`/`sessions` read back the update log.
- **collaboration**: two editors on one doc converge bidirectionally (Yjs).
- **viewer write-drop**: a viewer connection can READ, but its sync update frames
  are dropped — its edits never reach the server or other clients.
- **lazy create**: connecting to an unknown `docId` creates the row on first use
  (no explicit provisioning required).
- **persistence**: after the debounce window, edits append to `rtc_document_updates`
  (head seq increments) and the snapshot/`yjsState` + extracted `plainText` land on
  `rtc_documents` — **in the separate `RTC_DATABASE_URL` database**, not the app DB.
- **compaction** (tiered): old update rows fold into the snapshot per tier1/tier2 age.

## 5. DB separation invariant

- The app DB (`DATABASE_URL`) has **no** `rtc_*` tables; all RTC rows live in
  `RTC_DATABASE_URL`. Deleting a `Document` does **not** cascade RTC rows (no
  cross-DB FK) — cleanup is the backend's job via the internal API.

---

### Implemented tests + how to run

**Backend (1–3) — Nest e2e via supertest** (boots the real AppModule against `DATABASE_URL`):
- `backend/test/folders.e2e-spec.ts` — workspace CRUD, EDIT-to-create, READ/non-member
  denials, cycle guard, soft-delete + subtree cascade, 30-day purge window.
- `backend/test/documents.e2e-spec.ts` — PRIVATE default, full read matrix
  (owner/member/realm-overlay/PUBLIC/outsider), write gates (EDIT renames,
  ADMIN/owner deletes), public toggle, and the `rtc-token` endpoint
  (editor/viewer/denied→403, identity claims present).
- Run: `pnpm test`  (sources `.env`, then `pnpm --filter backend test:e2e`).
  Prereq: Postgres up + schemas pushed + seed run.

**RTC (4) — multi-user integration** (Yjs `WebsocketProvider`, node `ws` polyfill,
`disableBc:true` so all traffic goes through the server):
- `tests/rtc-multiuser.cjs` — editor↔editor convergence, viewer write-drop, denied
  reject, persistence to the separate rtc DB via the internal `versions` API.
- Run (with backend :4000 + rtc-server :4001/4002 running): `node tests/rtc-multiuser.cjs`.

**Content ops (AI authoring) — in-process, no servers**:
- `tests/content-ops.cjs` — every ContentOp end-to-end through the real headless
  binding + extractor: Part A targets each op (blocks, lists, tables, columns,
  media, in-place insert/format/delete, clear, guards, error 400s); Part B applies
  1100 unique seeded-random ops in 20-op batches to one live Y.Doc and verifies
  block structure + per-block text against a model after every batch.
- Run (after `pnpm --filter rtc-server build`): `node tests/content-ops.cjs`
  (`SEED=n` for a different stress sequence).

Status: backend 86/86 e2e green; rtc-multiuser 6/6 green; content-ops 32/32 green
(seeds 1, 7, 42, 123, 999, 31337).
