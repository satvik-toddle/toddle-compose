# Test plan — folders, documents (workspace RBAC) + RTC

Distilled from the POC's `tests/multiuser.cjs` and `tests/ui-flow.cjs`. Those were
full-stack Puppeteer flows (login → create doc → share it → two users converge →
presence avatars → reload persistence). Below is the same intent expressed as the
behaviours each layer must guarantee, so they can be covered by unit/integration
tests without driving a browser. Sharing is **per-person grants + share links only**;
there is no doc PUBLIC/PRIVATE visibility.

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

- **create**: requires EDIT; `workspaceId` + `ownerId` set;
  optional `folderId` must be a live folder in the same workspace.
- **read**: owner, any workspace READ (members + workspace ADMIN + realm
  OWNER/MAINTAINER overlay), a **per-page grant** (any role, any registered user),
  OR a valid **share link** within its scope. Otherwise 404 (existence hidden).
- **write** (rename/move/delete): creator OR effective doc role ≥ min,
  where effective doc role = MAX(workspace role, per-page grant); else 403. So a
  doc-ADMIN grantee can rename/move/delete; a doc-EDIT grantee can
  rename/move but gets 403 on delete.
- **move**: target folder must be in the document's workspace.
- **per-page permissions** (`GET/POST/PATCH/DELETE /documents/:id/permissions[/:userId]`):
  manage gate = owner / effective workspace ADMIN / doc-ADMIN grantee (else 403, 404 if
  doc missing); grant by email accepts any role (READ|COMMENT|EDIT|ADMIN) but only ever
  elevates — effective doc role = max(ws role, grant), so READ/COMMENT grants mint viewer
  RTC tokens while EDIT/ADMIN mint editor; 404 unregistered email, 409 owner, 409 duplicate;
  grant opens exactly one doc (no realm enrollment); POST also sends a best-effort
  "shared with you" email; DELETE also allowed for the grantee themselves (leave). No cascade
  to sub-pages. Grant-only users get guest workspace entry with the doc list filtered to
  grants; `GET /api/documents/shared-with-me` lists grant rows (doc + workspace + sharedAt +
  myRole + isStarred) across all workspaces, excluding owned docs.
- **share links** (`GET/PUT/DELETE /documents/:id/share-link`, `POST …/regenerate`,
  `GET /share-links/:token`, `POST /share-links/:token/rtc-token`): at most one link per doc; manage
  gate = owner / workspace ADMIN / doc-ADMIN. Scope `ANYONE` (works logged-out) vs `REALM` (signed-in
  realm member). Opening a `REALM` link with no authenticated user → 401 ("sign in to open this
  link"); authenticated non-member → 403 ("limited to members of the workspace's org"); unknown token
  → constant 404. `rtc-token` mints editor for `EDIT` links, viewer for `READ`/`COMMENT`; logged-out
  `ANYONE` visitors get a synthetic anonymous identity.
- **refresh-access / kick** (`POST /documents/:id/refresh-access`): revoking a grant/link or rotating
  a token **kicks** live RTC sockets and invalidates already-minted tokens — the revocation watermark
  is stamped by the **backend** clock (same clock that mints token `iat`, so no cross-service skew)
  and rejects any token with `iat <= watermark` (inclusive, closing the same-second escape).

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
- `backend/test/documents.e2e-spec.ts` — full read matrix
  (owner/member/realm-overlay/grantee/outsider), write gates (EDIT renames,
  ADMIN/owner deletes), per-page grant + share-link access, and the `rtc-token` endpoint
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
  media incl. image captions, in-place insert/format/delete — forward, backward,
  cross-block, offset-clamped — clear, guards, error 400s); Part B applies
  seeded-random ops in batches to one live Y.Doc and verifies block structure +
  per-block text against a model after every batch.
- Run (after `pnpm --filter rtc-server build`): `node tests/content-ops.cjs`
  (`SEED=n` other sequence, `OPS=n` op count, `BATCH=n` ops per delta).

Status: backend 86/86 e2e green; rtc-multiuser 6/6 green; content-ops 48/48 green
(incl. table row/col add/delete, cell edits + backgrounds, table/layout resize,
image links/captions, alignment, h1-h6) across seeds 1-50 (55k+ ops), a 5000-op
deep run, and BATCH=1 per-op-delta runs.
