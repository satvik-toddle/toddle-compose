# Toddle Compose — Functional Architecture (flow-by-flow)

This document describes the system **by functionality**. Each feature area lists its
distinct **cases**, and each case is a numbered step-by-step flow written as
`actor → action`, so it can be turned directly into a sequence diagram.

## Actors / systems (diagram lanes)

| Actor | What it is |
|-------|-----------|
| **User** | Person in a browser |
| **Frontend** | Vite + React app (`:5173`) |
| **Backend** | NestJS HTTP API, prefix `/api` (`:4000`) — auth, RBAC, folders, documents, mints RTC tokens, serves JWKS |
| **RTC** | NestJS Yjs collaboration server — WS **and** internal HTTP share one port (`:4001`) |
| **Indexer** | Detached search-index worker, own process (`:4100`) |
| **Storage** | Object storage (S3-compatible or local) for uploaded images/files |
| **Mailer** | Email transport (Resend / Gmail SMTP / console / bypass) |
| **App DB** | Postgres `toddle_compose` (users, realm, workspaces, folders, documents, `content_text`) |
| **RTC DB** | Postgres `toddle_compose_rtc` (Yjs update log + snapshots + stale queue) |
| **Coda** | External Coda REST API (migration flows, feature branches only) |

**Role ladders** (resolved per-request from the DB, never from the JWT — demotions apply immediately):
- Realm: `MEMBER < MAINTAINER < OWNER`
- Workspace: `READ < COMMENT < EDIT < ADMIN`
- Effective workspace role = MAX(direct membership, realm OWNER/MAINTAINER→ADMIN overlay, PUBLIC-workspace→READ overlay)
- Effective **doc** role = MAX(effective workspace role, per-page grant) — grants only ever elevate

**Two document types** (this branch): `DOC` (Lexical rich text) and `SHEET` (spreadsheet grid). Both persist to the same Yjs store keyed by document id; only the client surface and the content roots differ. "Public" for a document is a share link (§4), not a visibility flag.

---

# 1. Authentication

Access token = HS256 JWT (`type:"access"`, ~15 min). Refresh token = opaque random, only its SHA-256 hash is stored (~24h). Passwords = bcrypt (cost 12). Verification/reset tokens = opaque random, hashed at rest (~15 min TTL, 60s resend cooldown).

### Case 1 — Sign Up / Registration
- User submits name + email + password (`RegisterPage`, client checks password match + min length)
- Frontend → `POST /api/auth/register {name,email,password}` (unauthenticated)
- Backend loads the realm by `REALM_ID`; if missing → `403 "registration not available"`
- Backend checks the email-domain allowlist; empty = open, else domain must be listed → else `403 "not authorised to join this realm"`
- Backend looks up the user in App DB by email:
  - exists + verified → `409 "email already registered"`
  - exists + unverified → silently re-issue verification (no info leak)
  - new → bcrypt-hash password, pick avatar color, create user with `emailVerifiedAt = null`
- Backend issues a verification token (see Case 2) → returns `{status:"verification_sent", email, emailDelivered}`
- Frontend routes to `/register/check-email` (or `/login` if the mailer is bypassed and the user is auto-verified)

### Case 2 — Email verification
Issue:
- Backend: if mailer is bypassed → set `emailVerifiedAt = now`, send nothing, done
- Backend: else enforce per-account resend cooldown; if a recent token exists, reuse it (send nothing)
- Backend mints a raw token; in one transaction consumes prior tokens + stores `sha256(token)` with expiry
- Backend → Mailer sends `${FRONTEND_URL}/verify-email?token=<raw>` (dev logs the link)

Consume:
- User clicks the email link → `VerifyEmailPage` auto-fires once
- Frontend → `POST /api/auth/verify-email {token}`
- Backend looks up by token hash; not found → `400 "invalid token"`
- Backend branches: already consumed + already verified → idempotent `200`; already consumed → `400 "already used"`; expired → `400 "expired"`
- Backend (transaction): mark token consumed, set `user.emailVerifiedAt = now`, consume all other outstanding tokens → `{status:"verified"}`

Resend:
- User (from login / check-email) → `POST /api/auth/resend-verification {email}` → re-issues only if user exists and is unverified; always returns generic `verification_sent`

### Case 3 — Login / Sign In
- User submits email + password (`LoginPage`)
- Frontend → `POST /api/auth/login {email,password}` (unauthenticated)
- Backend looks up user by email; not found → `401 "invalid credentials"`
- Backend `bcrypt.compare`; mismatch → `401 "invalid credentials"` (same message = no user enumeration)
- Backend: if `emailVerifiedAt` is null → `403 {code:"EMAIL_NOT_VERIFIED"}` (frontend shows "not verified" + resend button)
- Backend issues tokens: mint access JWT, generate refresh token, store its hash in App DB → `{accessToken, refreshToken, expiresIn, user}`
- Frontend stores tokens (access in memory, refresh persisted), sets status `authed`, broadcasts to other tabs, navigates in

### Case 4 — Attach token + refresh (rotation)
- Frontend attaches `Authorization: Bearer <access>` to every authed request
- Backend `JwtAuthGuard` verifies signature + iss/aud/alg + `type==="access"`, loads user by `sub`; any failure → `401`
- On a `401`, Frontend runs a single-flight refresh: `POST /api/auth/refresh {refreshToken}`
- Backend looks up by token hash; not found → `401`
- Backend: if the token is already revoked (reuse of a rotated token) → treat as theft: **revoke the entire token family** → `401`
- Backend: if expired → `401`
- Backend: revoke the presented token, issue a brand-new access + refresh pair (rotation)
- Frontend on success retries the original request once; on failure → hard `clearSession()` (logout)

### Case 5 — Enter / leave a workspace (scoped token)
- User opens a workspace → Frontend `POST /api/auth/workspace/enter {workspaceId}`
- Backend checks workspace access, re-mints the access token with `activeWorkspaceId` set
- Leaving → `POST /api/auth/workspace/leave` re-mints with `activeWorkspaceId = null`

### Case 6 — Logout
- User clicks logout → Frontend `clearSession()` locally + broadcasts to tabs
- Frontend → `POST /api/auth/logout {refreshToken}` (fire-and-forget, unauthenticated)
- Backend sets `revokedAt = now` on the matching refresh row (idempotent; unknown token = no-op)

### Case 7 — Forgot / reset password
Request:
- User submits email → Frontend `POST /api/auth/forgot-password {email}`
- Backend: if user exists, issue a reset token + email `${FRONTEND_URL}/reset-password?token=<raw>`; **always** returns generic `reset_email_sent` (no leak)

Reset:
- User opens the link, submits a new password → Frontend `POST /api/auth/reset-password {token,password}`
- Backend looks up by token hash; not found/consumed/expired → `400`
- Backend (transaction): set new bcrypt hash, verify the email if not already, consume the token, **revoke ALL the user's refresh tokens** (force re-login everywhere) → `{status:"reset"}`

### Case 8 — Bootstrap (first realm + owner)
- Backend refuses to boot unless a realm matching `REALM_ID` exists
- `pnpm db:init` (idempotent): upsert realm, bcrypt-hash the owner password, upsert the owner user (`emailVerifiedAt = now`), upsert `RealmMember{role:"OWNER"}`
- There is **no invite-token flow** — everyone else self-signs-up, then joins a workspace/realm by discovery/request

---

# 2. Realm & org membership

One active realm per deployment (single tenant). Every user/workspace/request is scoped to it.

### Case 1 — View realm info
- Frontend → `GET /api/realm`
- Backend resolves the caller's realm role (no minimum required) → `{id,name,role,joinRequestsEnabled}`; `allowedEmailDomains` included **only** for OWNER/MAINTAINER

### Case 2 — Update realm settings (OWNER only)
- Admin edits allowed email domains / join-requests toggle → `PATCH /api/realm`
- Backend requires realm `OWNER` (else 403), validates domains → updates App DB

### Case 3 — Manage realm members (add / change role / remove)
- Assignable roles are MAINTAINER / MEMBER only (OWNER is never assignable/removable)
- Add: `POST /api/realm/users {email,role}` — requires authority over the target role (OWNER needed to add a MAINTAINER); user must already be registered; 409 if already a member
- Change role: `PATCH /api/realm/users/:id` — requires authority over both current and new role
- Remove: `DELETE /api/realm/users/:id` — transaction cascades: delete the member's workspace memberships + pending join requests, then the realm membership (not a ban)

### Case 4 — Org join requests (when `joinRequestsEnabled`)
- Signed-in non-member sees the org-join gate → `POST /api/realm/join-requests`
- Backend: 403 if disabled, 409 if already a member or a request is pending; else upsert an `orgJoinRequest` (PENDING)
- User polls `GET /api/realm/join-requests/mine`; on APPROVED the frontend re-fetches the realm and goes to the launcher
- Realm MAINTAINER+ lists (`GET`), approves (`POST /:id/approve`) or rejects (`POST /:id/reject`); approve upserts `RealmMember{role:MEMBER}`

---

# 3. Workspaces & RBAC

### Case 1 — Create workspace (realm MAINTAINER+)
- User clicks "New workspace" → `POST /api/workspaces {name,visibility?,defaultRole?}`
- Backend requires realm `MAINTAINER` → creates the workspace and auto-adds the creator as workspace `ADMIN`

### Case 2 — List / get / enter
- List: `GET /api/workspaces` — realm OWNER/MAINTAINER see ALL as ADMIN; others see only direct memberships
- Get one: `GET /api/workspaces/:id` — member gets their role; a per-page grantee gets `{role:READ, guest:true}`; else 403
- Enter: `POST /api/auth/workspace/enter` (see Auth Case 5) mints the scoped token

### Case 3 — Update / delete workspace (workspace ADMIN)
- Update name / visibility / defaultRole: `PATCH /api/workspaces/:id` (ADMIN)
- Delete: `DELETE /api/workspaces/:id` (ADMIN)

### Case 4 — Manage members (add / change role / remove)
Guardrails (`assertCanManageMember`): the realm OWNER's membership is untouchable by anyone; a realm MAINTAINER is manageable only by the realm OWNER; granting/demoting/removing a workspace ADMIN is realm-admin-only (self-changes exempt); the sole ADMIN can't be demoted/removed.
- List: `GET /api/workspaces/:id/users` (READ) — attaches each member's realm role for UI gating
- Add: `POST /api/workspaces/:id/users {email,role}` (ADMIN) — user must be registered; 409 if already a member; transaction upserts realm MEMBER then creates the workspace membership
- Change role: `PATCH /api/workspaces/:id/users/:userId` (ADMIN, SERIALIZABLE tx)
- Remove: `DELETE /api/workspaces/:id/users/:userId` (ADMIN, SERIALIZABLE tx)

### Case 5 — Self-join a PUBLIC workspace
- User (on `/access`) clicks Open → `POST /api/workspaces/:id/join`
- Backend: workspace must be PUBLIC (else 403 "request instead"); 409 if already a member; transaction upserts realm MEMBER + creates membership at the workspace's `defaultRole`

### Case 6 — Org-scoped sharing (PUBLIC visibility)
- Admin sets a workspace `visibility=PUBLIC` (+ `defaultRole`)
- Effect: every realm member gets an implicit workspace `READ` overlay without joining, and PUBLIC workspaces appear in their list; joining upgrades that to a real `defaultRole` membership
- Discovery: `GET /api/workspaces/discoverable` lists workspaces the caller isn't in

### Case 7 — Request access to a PRIVATE workspace
- User (on `/access`) clicks Request access → `POST /api/workspaces/:id/requests {requestedRole?}`
- Backend: 400 if PUBLIC, 409 if already a member or a request is pending; else create a PENDING `joinRequest`
- User polls `GET /api/workspaces/my-requests`; auto-enters on APPROVED
- Managers list per-workspace (`GET /:id/requests`, ADMIN) or realm-wide inbox (`GET /api/workspaces/join-requests`), then approve (`POST /:id/requests/:reqId/approve`, upserts realm MEMBER + workspace membership) or reject

---

# 4. Sharing a document

Two mechanisms, both gated by **doc-manage** = doc owner OR effective workspace ADMIN OR doc-ADMIN grantee.

### Case 1 — Per-page permission grants ("Shared with me")
- Manager searches grantable users → `GET /api/documents/:id/grantable-users` (realm members only)
- Manager adds a grant → `POST /api/documents/:id/permissions {email,role}` — grantee must be a realm member, not the owner, no duplicate; creates `documentPermission` + best-effort "shared with you" email
- Update: `PATCH /api/documents/:id/permissions/:userId` (doc-manage)
- Remove: `DELETE /api/documents/:id/permissions/:userId` (doc-manage **or** self — "leave this page")
- Grantee consumes: doc appears under `GET /api/documents/shared-with-me`; enters the workspace shell as a read-only guest
- Grants only ever **elevate**; they never enroll the grantee in the realm and never authorize restructuring (move/delete)

### Case 2 — Share link: manage (doc-manage)
A doc has at most one link; the token is the credential. Roles capped at READ/COMMENT/EDIT; scope `REALM` (org members) or `ANYONE` (works logged-out).
- Get: `GET /api/documents/:id/share-link`
- Create/update (upsert role + scope): `PUT /api/documents/:id/share-link {role,scope}` (keeps the token on update)
- Regenerate (old URL dies immediately): `POST /api/documents/:id/share-link/regenerate`
- Revoke: `DELETE /api/documents/:id/share-link`
- Refresh access ("Apply now" — kick live users to force re-auth): `POST /api/documents/:id/refresh-access` → Backend → RTC internal kick (see §7 Case K)

### Case 3 — Share link: consume (unguarded — token is the credential)
- Visitor opens `/link/:token` → Frontend `GET /api/share-links/:token`
- Backend loads the link (constant 404 for unknown tokens), applies the scope gate:
  - `ANYONE` → no auth needed
  - `REALM` → 401 if not signed in, 403 if signed in but not a realm member
- Backend returns `{document, role, scope}`
- To edit/view live: Frontend `POST /api/share-links/:token/rtc-token` — link EDIT→editor else viewer; an anonymous ANYONE visitor gets a synthetic guest identity (name/color) for awareness

---

# 5. Folders

Note: the workspace UI models every "page" as a Document and builds its tree from document `parentId`; the Folder REST API below is backend-complete but has a thin frontend surface. Folders are workspace-scoped.

### Case 1 — Create folder
- Frontend → `POST /api/folders {workspaceId?,parentId?,name}`
- Backend resolves the workspace (body or session; 400 if neither), requires workspace `EDIT`, validates the parent is in the same workspace → creates the folder

### Case 2 — Rename folder
- `PATCH /api/folders/:id {name?,icon?}` — write gate: owner needs workspace READ, non-owner needs workspace ADMIN → update

### Case 3 — Move folder
- `PATCH /api/folders/:id/move {parentId?}` — write gate as above; reject self-parent; assert the new parent is in the same workspace; `assertNoCycle` walks parent→root (max depth 256) → re-parent

### Case 4 — Delete folder (soft-delete + purge)
- `DELETE /api/folders/:id` — write gate; collect the folder + all live descendant folder ids; set `deletedAt = now` on the subtree (hidden from all reads immediately). Documents keep their `folderId`.
- Daily 3AM cron purges folders `deletedAt < now-30d`: in one transaction delete their documents then the folders, then best-effort RTC teardown per purged doc

---

# 6. Document lifecycle (create / open / rename / move / delete / star)

These are the metadata/tree operations — they go through the **Backend HTTP API**. They are the same for DOC and SHEET except where noted.

### Case 1 — Create DOC
- User picks "Doc" from the create menu → Frontend `POST /api/documents {workspaceId?, parentId? | folderId?}` (type omitted → defaults `DOC`)
- Backend requires workspace `EDIT`, validates placement (parent doc or folder in the workspace)
- Backend creates the document row (`type=DOC`; `parentId` wins over `folderId`), seeds the hot-doc cache
- Backend (best-effort, non-blocking) → RTC `POST /internal/docs/init {docId}` to provision the empty RTC row
- Backend emits a live `documentCreated` event to workspace subscribers
- User opens it → live editing begins (§7)

### Case 2 — Create SHEET
- User picks "Sheet" from the create menu → Frontend `POST /api/documents {…, type:"SHEET"}`
- Backend path identical to Case 1 but stores `type=SHEET`
- **First-open seed** (client-side, once): on opening, the client waits for the provider `sync`; if it can edit **and** the grid is empty, it seeds A–Z (26) text columns + 100 empty rows in one Yjs transaction (`seedSheet`), guarded on "synced && empty" so an existing sheet is never re-seeded ⟶ **W** (§7)

### Case 3 — Open / read a DOC
- User clicks the doc → Frontend mounts `DocEditor` and mints an RTC token (§7 Case 1)
- The Lexical editor binds the shared Yjs `root` (rich-text XML tree); the server pre-loads persisted state so the first render isn't blank
- If the resolved role isn't `editor`, the editor mounts **view-only**

### Case 4 — Open / read a SHEET
- User clicks the sheet → Frontend mounts `SheetEditor`, mints an RTC token, binds the Yjs roots `rows` / `colTypes` / `optionSets`
- `readSheetRows` maps the Yjs rows into ds-data-grid rows; columns are sorted by each column's stored `order`, the visible letter (A, B, … AA) derived from position; an absent cell key reads as empty
- Non-editors see a read-only grid

### Case 5 — Read the head content without WS (search preview)
- Frontend `GET /api/documents/:id/preview` → Backend fetches live head content from RTC → `{lexicalJson, plainText}` (DOC) or `{sheet}` (SHEET), rendered read-only in the preview pane (§9 Case 1)

### Case 6 — Rename document (DOC or SHEET)
- Frontend `PATCH /api/documents/:id {title}` — gate `requireDocWrite` (owner on any standing role, else effective role ≥ EDIT) → write-through update + `documentUpdated` event

### Case 7 — Move document (DOC or SHEET)
- Frontend `PATCH /api/documents/:id/move {parentId? | folderId?}` — gate `requireWorkspaceDocRole ≥ EDIT` (a per-page grant does NOT authorize restructuring)
  - `parentId` set → nest (reject self-parent, assert parent in workspace, cycle check max depth 256, clears `folderId`)
  - `folderId` set → file into folder (clears `parentId`)
  - neither → detach to workspace root
- No RTC call — content is unchanged; emits `documentUpdated`

### Case 8 — Delete DOC
- User deletes → Frontend `DELETE /api/documents/:id` — gate `requireWorkspaceDocRole ≥ ADMIN` (creator or workspace ADMIN; a grant is insufficient)
- Backend collects the doc + all descendant docs (recursive CTE), hard-deletes (cascade removes subdocs, stars, permissions, share link), invalidates caches
- Backend (best-effort) → RTC `DELETE /internal/docs/:id` per subtree id (closes live sockets, evicts, transaction-deletes the RTC doc + all its update rows)
- Backend emits `documentDeleted`
- Hard delete is immediate — no 30-day retention (that exists only for folders, §5 Case 4)

### Case 9 — Delete SHEET
- **Identical to Case 8** — deletion is type-agnostic (same endpoint, same ADMIN gate, same cascade + RTC teardown). The SHEET's `rows`/`colTypes`/`optionSets` are inside the RTC doc, so they are removed by the same RTC-doc delete.

### Case 10 — Star / unstar (DOC or SHEET)
- Frontend `POST | DELETE /api/documents/:id/star` — any read access

---

# 7. Live editing engine (shared RTC path)

Everything below flows over the **Yjs WebSocket**, not the HTTP API. The write path is the same for every content edit, so it is defined once here and referenced as **⟶ W** by each DOC/SHEET operation in §8.

### Case 1 — Open a doc: connect + auth + role enforcement
- Frontend mints an RTC token (§6 Case 6 → `POST /api/documents/:id/rtc-token`; RS256 JWT, ~5 min TTL, claims `{docId, role, name, email, color}`), re-minted every ~4 min; the token lives in a mutable ref so reconnects re-read a fresh one without tearing down the Y.Doc
- Frontend opens `ws://…/yjs/:docId?token=<jwt>`
- RTC `verifyClient` verifies the JWT against the backend JWKS (iss/aud/RS256); rejects `role:"denied"` / malformed claims
- RTC enforces `claims.docId === URL docId` (403 mismatch)
- RTC checks the kick watermark: token `iat` older than the doc's last kick second → `401 "access changed"`
- RTC pre-loads persisted state, accepts, registers `ws→claims`, arms a socket-close timer at token `exp`
- RTC installs the message wrapper (awareness coalescing + rate-limit + viewer-write drop), then hands off to y-websocket

### Case W — The RTC write path (referenced by every edit in §8)
1. Editor client mutates the Y.Doc **inside `ydoc.transact(...)`** on a specific root (DOC: `root`; SHEET: `rows` / `colTypes` / `optionSets`)
2. The provider sends the Yjs update frame; RTC passes it through the per-connection token-bucket rate limiter (over-limit → close 1008). **If `role==="viewer"`, the sync frame is dropped here** (not applied, not broadcast)
3. y-websocket applies the update to the shared server Y.Doc and **broadcasts it to all other connected clients** (they see the change live)
4. RTC append-coalesces the blob into an `RtcDocumentUpdate` row (flush on author change, 200 updates, 256KB, or 1s), assigning `seq = max+1`
5. RTC debounce-flushes a snapshot (2s idle, 10s hard cap): in ONE transaction write `RtcDocument.yjsState` / `snapshotAtSeq` / `version++` **and** enqueue `StaleDocument`, then ping the Indexer
6. Indexer drains the queue, extracts text (SHEET grid text / DOC tree text), and seq-guarded-upserts `documents.content_text` (§9 Case 2)

### Case 2 — Awareness / presence cursors
- Client emits awareness frames (cursor/selection + name/color) via the provider
- RTC detects awareness (message type 1) and, within budget (burst 30, 15/sec), delivers immediately, bypassing the sync rate limiter
- Over budget: only the latest awareness frame is kept and delivered on a 100ms trailing timer (bounds N² presence chatter)
- Awareness is never persisted; on disconnect the trailing buffer/timer are cleared

### Case 3 — Last client disconnects
- RTC `writeState`: checkpoint → flush → per-doc compaction → evict in-memory state (guarded against a concurrent reconnect)

### Case K — Force-refresh access (kick)
- On a share-access change, Backend → RTC `POST /internal/docs/:id/kick {kickedAt}`
- RTC sets the doc's in-memory kick watermark (self-expiring at 300s) and closes every live socket with code `4001 "access changed"`
- Reconnects presenting a pre-kick `iat` are rejected at `verifyClient` (Case 1); the frontend treats `4001` as "re-mint token immediately"

### Case C — Tiered compaction (background)
- Scheduler arms ~30s after boot, then every 6h (self-re-arming, non-overlapping); each tick records an `RtcCompactionRun`
- Tier 1 (session merge): rows `seq ≤ snapshotAtSeq`, older than 12h, grouped by `(clientSub, 30s gap)`; each ≥2-row group merged into one `session-compacted` row (keeps summed `mergedCount`)
- Tier 2 (archive): rows `seq ≤ snapshotAtSeq`, older than 30d (including compacted rows), all merged into one `archive` row

---

# 8. Content edit operations (granular)

Every operation below is a client-side Yjs mutation that then flows through **⟶ W** (§7 Case W): broadcast to peers → persisted → re-indexed. Viewer-role clients are blocked at step 2 of W.

## 8A. DOC content operations

### DOC-Edit — Edit text / formatting
- User types / applies formatting → the Lexical CollaborationPlugin writes the change into the shared `root` XML tree ⟶ **W**

### DOC-Image — Insert image / file (upload)
- User inserts via device picker, paste, drag-drop, or URL-add (URL-add is re-fetched then re-uploaded)
- Editor calls `uploadToServer(file)`:
  - If there's no access token (anonymous link visitor) → toast "Sign in to upload images and files", abort (no broken empty node)
  - Frontend `POST /api/uploads` (multipart, auth-guarded, size-capped via multer), streaming byte-progress into the upload panel
  - Backend stores the object in Storage, returns `{key, url}`
- Editor inserts an image/file node carrying that URL into `root` ⟶ **W**
- (`GET /api/uploads/:key` serves the bytes back when the node renders)

### DOC-View — Read-only enforcement
- If the RTC role isn't `editor`, the editor mounts `viewOnly` (no toolbar/slash actions); the server also drops any viewer sync frame at W step 2

## 8B. SHEET content operations

All SHEET ops resolve the target **row/column by its uuid id** against live Yjs state (grid indexes go stale under concurrent edits), and run inside one `ydoc.transact(...)`. Column ids are opaque uuids so two clients adding at once can't collide; the letter label is derived from `order` at render.

### SHEET-Cell-Edit — Edit a cell value
- User commits a cell edit → `applySheetEdits` / `setSheetCell` finds the row map and does `row.set(colId, value)` (type-aware coercion: radio→boolean, dropdown/tag→selected option ids, dateTime→ISO string) ⟶ **W**
- If the edit was in the last row, the client also appends a fresh empty row (see SHEET-Row-Add) so there's always a trailing blank row

### SHEET-Cell-Clear — Clear a cell
- `clearSheetCell` does `row.delete(colId)` (removes the key outright rather than storing `""`, so an empty cell holds no entry) ⟶ **W**

### SHEET-Row-Add — Add a row (append or insert)
- Append: `appendSheetRow` creates a `Y.Map` with a new `__id`, `yRows.push([row])` ⟶ **W**
- Insert above/below: `insertSheetRow` resolves the anchor row by id, computes the insert index, `yRows.insert(index, [row])` ⟶ **W**

### SHEET-Row-Clear — Clear a row's contents
- `clearSheetRow` snapshots the row's content keys (excluding `__id` and `#meta` keys) and deletes each — values cleared, cell types kept (Google-Sheets "clear contents") ⟶ **W**

### SHEET-Row-Delete — Delete a row
- `deleteSheetRow`: if only 1 row remains → **refuse** (returns false, a sheet always keeps ≥1 row); else resolve the index by id and `yRows.delete(index, 1)` ⟶ **W**

### SHEET-Col-Add — Add a column (append or insert)
- Append: `appendSheetColumn` sets `colTypes[newUuid] = {type:'text', order: maxOrder+1}` ⟶ **W**
- Insert left/right: `insertSheetColumn` computes a **fractional order** between the two neighbours (so no other column's entry is rewritten) and sets `colTypes[newUuid] = {type:'text', order}` ⟶ **W**

### SHEET-Col-Clear — Clear a column's contents
- `clearSheetColumn` deletes `colId` from every row map; the column itself stays ⟶ **W**

### SHEET-Col-Delete — Delete a column
- `deleteSheetColumn`: if only 1 column remains → **refuse**; else delete `colId` from `colTypes` and, from every row, delete both the value (`colId`) and its meta (`colId#meta`) so no orphaned data lingers ⟶ **W**

### SHEET-Cell-Type — Change a cell/range type
- `setSheetCellType` writes each cell's `<colId>#meta` (stored on the row map so a row delete cleans it up for free). The stored value is left untouched, so switching back to text recovers the original content:
  - `dropdown` / `tag` → reuse the range's shared option-set id or create a new empty one; point each cell's meta at it
  - `dateTime` → keep each cell's existing picker variant
  - other types → set `{type}` ⟶ **W**

### SHEET-Options — Configure dropdown/tag options
- `saveDropdownOptions` sets `optionSets[setId] = {options, isMulti}`. If the selection had no single set, it creates one and re-points every selected cell's meta at it — so a whole range shares one option list, and editing it updates them all ⟶ **W**

### SHEET-DateVariant — Set the dateTime picker variant
- `setSheetDateTimeVariant` writes `{type:'dateTime', config:{pickerType: variant}}` into `#meta` for each dateTime cell (date / dateTime / time / week / month / year) ⟶ **W**

---

# 9. Version history

### Case 1 — Enter history mode (read-only) — DOC only
- User opens a DOC with `?history=true` (+ `?v=<seq>`, `?diff=true`)
- Frontend requests the timeline: Backend → RTC `GET /internal/docs/:docId/sessions` → groups update rows by author + time gap, replays boundary states, computes before/after text (SHEET changed-cells), filters no-ops
- Frontend requests a version: Backend → RTC `GET /internal/docs/:docId/versions/:seq?include=render&diffAgainst=…` → replays blobs up to `seq`, headless-Lexical extraction (via vendored `server-nodes.cjs` worker pool), materializes upload URLs, optional diff marks → returns `{yjsStateB64, lexicalJson|sheet, diffJson?}`
- Frontend binds the returned Yjs bytes to a **read-only** editor with identical chrome (`viewOnly`)

### Case 2 — Capture (implicit)
- Every edit becomes an `RtcDocumentUpdate` row with `seq`/`origin`/`clientSub`/`createdAt` (§7 Case W step 4); tier-1 merged rows keep `mergedCount` so the timeline still counts raw edits

---

# 10. Search & indexing

### Case 1 — Search query
- User types in the search modal → Frontend debounces and drives an infinite query → `GET /api/documents/search?q=…&take=…[&workspaceId=…][&cursor=…]`
- Backend builds an access filter (workspace-scoped, or global = member workspaces + per-page grants)
- Backend runs ONE indexed query: `title ILIKE %q% OR content_text ILIKE %q%` (both pg_trgm GIN-indexed — no RTC round-trip), plus a count
- Backend keyset-seeks on `(updatedAt desc, id desc)`, sets a `title`/`content` badge and a ~120-char snippet per row → `{items,total,nextCursor}`
- User selects a result → Frontend `GET /api/documents/:id/preview` → read-only DocEditor (DOC) or read-only DataGrid (SHEET)

### Case 2 — Indexing pipeline (edit → searchable)
- A doc edit flushes in RTC → the snapshot write AND the `StaleDocument` enqueue happen in the **same transaction** (guarantee G1) → then a debounced ping to `POST :4100/wake` (a lost ping is harmless)
- Indexer `wake` coalesces pings into one sweep per interval (5s); a 60s safety sweep + a boot backfill (docs with an RTC snapshot but `content_seq IS NULL`) cover lost pings/downtime
- Drain: claim ≤500 stale rows (oldest-first, lock-free) → fetch each `RtcDocument.yjsState` → skip rows whose RTC state is gone (never blank a live row)
- Extract text synchronously: SHEET → grid text; DOC → walk the shared Y tree (version-proof, never throws)
- Write FIRST, then delete: seq-guarded bulk `UPDATE documents SET content_text, content_seq … WHERE content_seq IS NULL OR content_seq < seq` (G3), then guarded batch-delete of the stale rows (G2)
- The Indexer is its own process reading the RTC DB and writing the App DB directly; crash → exit for supervisor restart (queue is durable, writes idempotent)

---

# 11. Coda migration (feature branches — not on `feat/doc-search`)

> These flows live on `feat/copy-to-coda-v2` / `feat/copy-to-coda-migration`, not on the current branch. Included for completeness. All use a shared `CodaClient` (rate-limited, honors `Retry-After`) and encrypt Coda tokens at rest (`TokenCipher`).

### Case 1 — Admin bulk "Import from Coda" (Coda subtree → new workspace)
- Admin manages a **global** credential pool: `GET|POST|DELETE /api/admin/coda-import/credentials` (realm MAINTAINER+, tokens masked/encrypted)
- Admin validates a URL → `GET /api/admin/coda-import/validate?url=&credentialId=` — doc URL = whole-doc import, page URL = page-subtree import (counts descendants)
- Admin enqueues → `POST /api/admin/coda-import/jobs` — creates a NEW target workspace + a `QUEUED CodaImportJob`, then fire-and-forget pings the standalone import worker (`POST /run`, X-Internal-Token; worker also self-arms)
- Worker `tick`: plan unplanned jobs (idempotent per `(jobId,codaPageId)`) → `claimBatch` (atomic UPDATE + `FOR UPDATE SKIP LOCKED` + lease; a child is READY only once its parent's `createdDocId` is set — the per-node parent gate) → process items concurrently → finalize
- Per item: resolve parent doc → create the compose doc and persist `createdDocId` BEFORE any content write (idempotency invariant) → `coda.exportPage` → sanitize Coda HTML → replace the doc body via RTC → link a reverse mapping to the origin Coda page → mark SUCCEEDED
- Children of FAILED/SKIPPED parents cascade to SKIPPED; permanent vs transient retry budgets are tracked separately; crashed leases are reclaimed on boot

### Case 2 — Copy-to-Coda / export (compose docs → Coda)
- User configures a destination = `MigrationScope` (a Coda doc + encrypted token pool): `GET|POST|PATCH|DELETE /api/migration-scopes` (workspace EDIT/ADMIN)
- User enqueues → `POST /api/migration-scopes/:scopeId/jobs` — validates each source doc (readable, DOC-only, same workspace), then **freezes a point-in-time HTML snapshot per doc** (`getCodaHtml` → `{html,headSeq}`), so later edits/compaction don't change what's exported; creates a `QUEUED MigrationJob`
- Export worker (runs in the main API process, resume-from-DB on boot): same `claimBatch` + lease + parent-gate engine; per item resolve the Coda parent → `createPage` or `replacePage` (persist `codaPageId` before awaiting the mutation) → push the frozen HTML → poll until Coda materializes the page + returns its `browserLink` → upsert the `(sourceDocId, scopeId)` mapping (latest-wins under advisory lock)

### Case 3 — Per-doc synchronous "Import from Coda" (overwrite one open doc)
- User (with editor access) picks a scope + Coda URL → `POST /api/documents/:docId/import-from-coda {scopeId,url}`
- Backend: editor gate, assert the scope's workspace matches the doc's, resolve the URL → `codaPageId`, `coda.exportPage` → sanitize → replace the whole doc body via RTC (destructive, synchronous, no worker/queue)
