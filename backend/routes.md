# Backend API — Routes

Base URL (local): `http://localhost:4000`

Conventions:
- App routes are under the **`/api`** prefix. `GET /health` and `GET /.well-known/rtc-jwks.json` are **not** prefixed.
- **Auth = access + refresh tokens.**
  - **Access token** — short-lived JWT (HS256, default 15 min, `ACCESS_TOKEN_TTL_SEC`). Send as `Authorization: Bearer <accessToken>` on guarded routes.
  - **Refresh token** — opaque, longer-lived (default 24 h, `REFRESH_TOKEN_TTL_SEC`), **persisted hashed, rotating, revocable**. Used only to mint a new pair via `/api/auth/refresh`.
- Request/response bodies are JSON. Validation is strict (unknown fields stripped; invalid → `400`).
- `POST` success → HTTP **201**; `GET` → **200**.
- CORS is restricted to the `CORS_ORIGINS` allowlist (no wildcard).

> **Realm/workspaces:** this backend instance is pinned to ONE realm via the `REALM_ID` env
> var; it refuses to boot if no realm row matches (run `pnpm db:seed`, which provisions the realm
> + a static `OWNER`). Realm + workspace RBAC endpoints are documented below. Roles are resolved
> per-request server-side (never trusted from the JWT). See `docs/realm-workspace-rbac.md` for the
> broader design and `docs/realm-workspace-ui-brief.md` for the UI.

---

## Token model (how to use)

1. `register` / `login` → `{ accessToken, refreshToken, expiresIn, user }`.
2. Call guarded APIs with `Authorization: Bearer <accessToken>`.
3. When the access token expires (a guarded call returns `401`), POST the **refresh token** to `/api/auth/refresh` → a **new** `{ accessToken, refreshToken }`. The old refresh token is now invalid (rotation).
4. `logout` invalidates the refresh token server-side.

Storage guidance (frontend): keep the **refresh token** in the most protected store you can (ideally an httpOnly cookie set by your edge, or secure storage); keep the **access token** in memory. Reuse of a rotated refresh token revokes the whole token family (theft defence).

---

## Auth

### POST `/api/auth/register` — create a user
Public. Validation: `email` valid · `password` 6–200 chars · `name` 1–120 chars.
```json
{ "email": "ada@toddle.test", "password": "password123", "name": "Ada" }
```
`201`:
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "expiresIn": 900,
  "user": { "id": "ckxx…", "email": "ada@toddle.test", "name": "Ada", "color": "#5a5ae2" }
}
```
Errors: `409` email already registered · `400` invalid payload.

### POST `/api/auth/login` — exchange credentials for tokens
Public.
```json
{ "email": "ada@toddle.test", "password": "password123" }
```
`201`: same shape as register. Errors: `401` invalid credentials (same response whether email is unknown or password wrong — no user enumeration).

### POST `/api/auth/refresh` — rotate tokens
Public (the refresh token itself is the credential).
```json
{ "refreshToken": "<opaque>" }
```
`201`: a new `{ accessToken, refreshToken, expiresIn, user }`. Errors: `401` unknown / expired / already-rotated token · `400` missing `refreshToken`.

### POST `/api/auth/logout` — invalidate a refresh token
```json
{ "refreshToken": "<opaque>" }
```
`201` → `{ "ok": true }`. Idempotent (unknown token is a no-op). Errors: `400` missing `refreshToken`.

### GET `/api/auth/me` — current user
**Guarded** (`Authorization: Bearer <accessToken>`).
`200` → `{ "user": { "id", "email", "name", "color" } }`. Errors: `401` missing / non-Bearer / invalid / expired / non-access token, or user no longer exists.

---

## Realm / Workspace RBAC

Roles. **Realm:** `OWNER` > `MAINTAINER` > `MEMBER`. **Workspace (cumulative):** `READ` < `COMMENT`
< `EDIT` < `ADMIN`. Realm `OWNER`/`MAINTAINER` act as workspace `ADMIN` on every workspace (overlay).
All routes below are **guarded** (`Authorization: Bearer <accessToken>`). Roles are resolved
per-request from the DB — never read from the JWT.

### Workspace session (enter / leave)
The access token from login is identity-only. To act inside a workspace, "enter" it to get a token
scoped to that workspace; "leave" to drop back to the realm-wide view (realm admins then see all).

- `POST /api/auth/workspace/enter` — `{ workspaceId }` → `{ accessToken, expiresIn, workspaceId, role, guest }`.
  `403` if you have no access to the workspace · `404` if it isn't in this realm. A user who is not a
  workspace member but holds a per-page grant here enters as a **guest**: `role: "READ", guest: true`
  (the doc list is then filtered to just their granted docs — see Document permissions below).
- `POST /api/auth/workspace/leave` — → `{ accessToken, expiresIn, workspaceId: null }`.

### Realm
- `GET /api/realm` → `{ id, name, role }` (`role` is your realm role, or `null` if not a member).
- `GET /api/realm/users` → `[{ user, role, createdAt }]`. Requires realm `MEMBER`+. `?skip&?take`.
- `GET /api/realm/users/search?q=…&take=…` → `[{ id, email, name, color }]` — user-directory
  search for pickers (e.g. Workspace settings → Members). Case-insensitive substring match on **name
  or email** over **all registered users** (single-realm app), so users who haven't joined a workspace
  yet are still findable; ordered by name asc (id tiebreak). Requires realm `MEMBER`+ (not admin —
  workspace admins can search). `q` optional — omitted/blank returns the first `take` users
  (the dropdown's initial list); `take` defaults to 20, max 20.
- `POST /api/realm/users` — `{ email, role: "MAINTAINER" | "MEMBER" }` → add an existing user.
  `MAINTAINER`+ required; granting `MAINTAINER` is **owner-only**. `OWNER` is not assignable.
  `404` unknown email · `409` already a member · `400` invalid role (incl. `OWNER`).
- `PATCH /api/realm/users/:userId` — `{ role }` → change role (owner-only for anything touching a
  `MAINTAINER`). Cannot target/produce `OWNER`.
- `DELETE /api/realm/users/:userId` — remove from realm. Cannot remove the `OWNER`.

### Workspaces
Each workspace has a `visibility` (`PUBLIC` → anyone in the realm self-joins as `defaultRole`;
`PRIVATE` → request + approval) and a `defaultRole` (default `READ`).

- `GET /api/workspaces` → realm admins see all; everyone else sees only their memberships. A
  per-page doc grant does **not** surface the workspace here — grantees reach shared docs via
  `GET /api/documents/shared-with-me` (guest *entry* to the workspace shell still works, see
  workspace enter). Sorted by `createdAt` asc. `[]` when none. `?skip&?take`.
- `POST /api/workspaces` — `{ name, visibility?, defaultRole? }` → create (realm `MAINTAINER`+);
  creator becomes workspace `ADMIN`. `visibility` defaults to `PRIVATE`.
- `GET /api/workspaces/discoverable` → `PUBLIC` workspaces in the realm you can join (not already a
  member): `[{ id, name, visibility, defaultRole }]`. `?skip&?take`.
- `GET /api/workspaces/:id` → `{ ...workspace, role }`. Requires effective `READ`+ (`403` if no access,
  `404` if not in this realm).
- `PATCH /api/workspaces/:id` — `{ name?, visibility?, defaultRole? }` → requires workspace `ADMIN`.
- `DELETE /api/workspaces/:id` — requires workspace `ADMIN`.

### Joining workspaces
Realm admins (`OWNER`/`MAINTAINER`) are the approvers (they act as workspace `ADMIN` everywhere).

- `POST /api/workspaces/:id/join` — self-join a `PUBLIC` workspace as its `defaultRole`. `403` if the
  workspace is `PRIVATE` (request instead) · `409` if already a member. Side effect: ensures realm `MEMBER`.
- `POST /api/workspaces/:id/requests` — `{ requestedRole? }` → request to join a `PRIVATE` workspace
  (`PENDING`). `400` if the workspace is `PUBLIC` (join directly) · `409` if already a member or a request
  is already pending.
- `GET /api/workspaces/join-requests?state=PENDING&workspaceId=…` — **realm-wide inbox**: realm admins see
  every request in the realm (workspace admins see requests for the workspaces they administer). Optional
  `workspaceId` narrows to one workspace; `state` defaults to `PENDING`.
- `GET /api/workspaces/:id/requests?state=PENDING` — one workspace's requests. Requires `ADMIN`.
- `POST /api/workspaces/:id/requests/:requestId/approve` — `{ role? }` → adds the member (role defaults to
  the requested role) and marks the request `APPROVED`. Requires `ADMIN`. `409` if already decided.
- `POST /api/workspaces/:id/requests/:requestId/reject` — marks the request `REJECTED`. Requires `ADMIN`.

### Workspace members
- `GET /api/workspaces/:id/users` → `[{ user, role, realmRole }]`. Requires `READ`+. `realmRole` is the
  member's realm role (`OWNER`/`MAINTAINER`/`MEMBER` or `null`), so the UI can gate admin-only controls.
- `POST /api/workspaces/:id/users` — `{ email, role: READ|COMMENT|EDIT|ADMIN }` → add an existing user
  (requires `ADMIN`). Side effect: the user is ensured to be at least a realm `MEMBER`. `404` unknown
  email · `409` already a member.
- `PATCH /api/workspaces/:id/users/:userId` — `{ role }` → requires `ADMIN`.
- `DELETE /api/workspaces/:id/users/:userId` — requires `ADMIN`; refuses to remove the **last** `ADMIN` (`409`).

Membership-management gates (`POST`/`PATCH`/`DELETE` above, in addition to the workspace-`ADMIN` requirement):
- **Realm owner is untouchable** — modifying/removing a member whose realm role is `OWNER` → `403`.
- **Realm maintainers** may only be changed/removed by the realm `OWNER` → otherwise `403`.
- **Workspace `ADMIN` is realm-admin controlled** — granting `ADMIN`, or demoting/removing a member who
  currently holds workspace `ADMIN`, requires the actor to be a realm admin (`OWNER`/`MAINTAINER`) → else
  `403`. A plain workspace `ADMIN` manages only non-admin members. **Exception:** self-changes (actor ===
  target) skip this rule, still subject to the last-`ADMIN` guard and the owner/maintainer rules.

---

## Folders

All routes **guarded**. A folder belongs to a workspace; nesting is allowed (`parentId`). Access is
resolved per-request against the caller's workspace role.

Folder shape: `{ id, name, icon, parentId, workspaceId, ownerId, createdAt, updatedAt }`.

- `GET /api/folders?workspaceId=…` → list folders the caller can see (defaults to the active
  workspace from the session when `workspaceId` is omitted). `?skip&?take`.
- `POST /api/folders` — `{ name, icon?, parentId?, workspaceId? }` → create. `name` 1–120 chars,
  `icon` ≤16 chars. `parentId` nests under an existing folder in the same workspace; omit for
  top-level. `workspaceId` defaults to the active workspace.
  ```json
  { "name": "Design specs", "icon": "📐", "parentId": null }
  ```
  `201`:
  ```json
  {
    "id": "ckfa…",
    "name": "Design specs",
    "icon": "📐",
    "parentId": null,
    "workspaceId": "ckws…",
    "ownerId": "ckus…",
    "createdAt": "2026-06-10T09:00:00.000Z",
    "updatedAt": "2026-06-10T09:00:00.000Z"
  }
  ```
- `GET /api/folders/:id` → one folder. `404` if not found / no access.
- `PATCH /api/folders/:id` — `{ name?, icon? }` → rename / re-icon.
- `PATCH /api/folders/:id/move` — `{ parentId }` → re-parent (`null`/omitted → move to top level).
- `DELETE /api/folders/:id` — remove the folder.

> A background scheduler (`folders-purge.scheduler.ts`) periodically purges soft-deleted folders.

---

## Documents

All routes **guarded**. A document belongs to a workspace and is located either in a folder
(`folderId`) **or** nested under another document (`parentId`, making it a "subdoc") — never both.
It has a `type` (`DOC` rich-text editor | `SHEET` data grid; both share the same RTC/Yjs stack and
nest identically — a DOC and a SHEET may be parent/child of each other) and an owner.
Access combines ownership, workspace role, and per-page grants (see Document permissions below).
Documents form a workspace-scoped tree; deleting a document cascade-deletes its whole subdoc subtree.

**One generic id-addressed API for both kinds.** There is no per-kind route — you fetch any document
by its id under `/api/documents/:id` and the `type` field tells you what it is. Where a response is
kind-specific (e.g. the history snapshot), the server resolves `type` from the stored document and
dispatches internally to the right handler; the caller never specifies a kind.

Document shape: `{ id, title, icon, type, workspaceId, folderId, parentId, createdAt, updatedAt, owner }`
(`owner` is a public user summary).

- `GET /api/documents?folderId=…&parentId=…&workspaceId=…` → list documents. All filters optional;
  omit `workspaceId` to use the active workspace, omit `folderId`/`parentId` for the whole workspace.
  `parentId=null` (or empty) returns only top-level docs (no parent); `parentId=<id>` returns that
  document's direct subdocs. `?skip&?take`.
- `GET /api/documents/shared-with-me` → the caller's grants across **all** workspaces (no
  `workspaceId`; powers the launcher's global "Shared with me"), newest grant first, excluding docs
  they own. Each row is the document summary plus `workspace: { id, name }`, `sharedAt`, `myRole`, and
  `isStarred`. `?skip&?take`.
- `POST /api/documents` — `{ title?, icon?, type?, folderId?, parentId?, workspaceId? }` → create.
  `title` 1–200 chars, `icon` ≤16 chars. `type` is `DOC` (default) or `SHEET`; when `icon` is omitted
  it defaults per kind (`📄` for DOC, `📊` for SHEET). `parentId` nests it under an existing document of
  the same workspace (a subdoc, of either kind) — when set, `folderId` is ignored. Otherwise `folderId`
  places it in a folder of the same workspace. `workspaceId` defaults to the active workspace. `400` on
  an invalid `type`; `404` if the target folder/parent isn't in the workspace.
  ```json
  { "title": "Q3 numbers", "type": "SHEET", "folderId": "ckfa…" }
  ```
  `201`:
  ```json
  {
    "id": "ckdo…",
    "title": "Q3 numbers",
    "icon": "📊",
    "type": "SHEET",
    "workspaceId": "ckws…",
    "folderId": "ckfa…",
    "parentId": null,
    "createdAt": "2026-06-10T09:00:00.000Z",
    "updatedAt": "2026-06-10T09:00:00.000Z",
    "owner": { "id": "ckus…", "name": "Ada", "color": "#5a5ae2" }
  }
  ```
- `GET /api/documents/:id` → one document **plus `breadcrumbs`** — the ancestor chain root → this doc
  (this doc last), each `{ id, title, icon }`. The collaborative body lives in the rtc-database and is
  fetched over the RTC WebSocket, not here. `404` if not found / no access.
  `200`:
  ```json
  {
    "id": "ckdo…", "title": "API design", "icon": "📄", "type": "DOC",
    "workspaceId": "ckws…",
    "folderId": null, "parentId": "ckpa…",
    "createdAt": "…", "updatedAt": "…",
    "owner": { "id": "ckus…", "name": "Ada", "color": "#5a5ae2" },
    "breadcrumbs": [
      { "id": "ckpa…", "title": "Engineering", "icon": "📁" },
      { "id": "ckdo…", "title": "API design", "icon": "📄" }
    ]
  }
  ```
- `GET /api/documents/:id/subdocs` → array of the document's direct subdocs (immediate children),
  each in the document shape above. Requires READ on the parent. `?skip&?take`. `404` if no access.
- `GET /api/documents/:id/hierarchy` → the sidebar tree for this document: the **root ancestor**,
  expanded down the spine to this document. Every node on the path lists ALL its direct children;
  the child that continues the path is itself expanded, while off-path siblings are collapsed
  (`children: null`, with `childCount` for an expand chevron). Built for rendering a focused tree
  sidebar. Requires workspace READ (a grant-only viewer not in the workspace gets `404`).
  Node shape: `{ id, title, icon, type, parentId, childCount, children }` — `type` (`DOC`|`SHEET`)
  lets the sidebar render the right glyph and open the right view from the id alone (no extra fetch).
  For a document at `p1 → c2 → c3`, `200`:
  ```json
  {
    "id": "p1", "title": "Parent 1", "icon": "📄", "type": "DOC", "parentId": null,
    "childCount": 2,
    "children": [
      { "id": "c1", "title": "Child 1", "icon": "📄", "parentId": "p1", "childCount": 0, "children": null },
      {
        "id": "c2", "title": "Child 2", "icon": "📄", "parentId": "p1",
        "childCount": 1,
        "children": [
          {
            "id": "c3", "title": "Child 3", "icon": "📄", "parentId": "c2",
            "childCount": 2,
            "children": [
              { "id": "c3a", "title": "Leaf A", "icon": "📄", "parentId": "c3", "childCount": 0, "children": null },
              { "id": "c3b", "title": "Leaf B", "icon": "📄", "parentId": "c3", "childCount": 0, "children": null }
            ]
          }
        ]
      }
    ]
  }
  ```
- `POST /api/documents/:id/rtc-token` → mint a short-lived RS256 RTC token for live collaboration.
  Resolves the caller's role (`editor` | `viewer`) against the live DB; `403` if no access, `404` if
  the doc doesn't exist. `201` → `{ token, docId, role }`. The client presents `token` to the
  rtc-server WebSocket, which verifies it via `/.well-known/rtc-jwks.json`.
  `201`:
  ```json
  { "token": "<rs256-jwt>", "docId": "ckdo…", "role": "editor" }
  ```
- `GET /api/documents/:id/history` → per-author edit sessions (the "who changed what, when" timeline),
  newest first. Read access required (same gate as `GET /:id`). Each session resolves the author from
  the app DB; for SHEET docs `changedCells` lists the `{ rowId, colId }` cells touched in that session
  (empty for DOC docs). `200`:
  ```json
  {
    "docId": "ckdo…", "head": 42,
    "sessions": [
      {
        "firstSeq": 30, "lastSeq": 42, "startedAt": 1717000000000, "endedAt": 1717000600000,
        "updateCount": 13, "totalBytes": 2048, "kind": "edit", "noop": false,
        "changedCells": [ { "rowId": "r1", "colId": "c2" } ],
        "user": { "id": "ckus…", "name": "Ada", "email": "ada@…", "color": "#5a5ae2" }
      }
    ]
  }
  ```
- `GET /api/documents/:id/history/:seq` → read-only snapshot of the document at update `seq`. Read
  access required; `400` if `seq` is not a non-negative integer. This is a **generic id route**: the
  server resolves the document's `type` and dispatches to the matching handler, so the payload is
  kind-specific. The response always includes `type`. For a **SHEET**, `sheet` is the reconstructed
  grid (`{ rows, colTypes }`); for a **DOC**, `lexicalJson` is the server-extracted Lexical
  editorState at that seq (upload URLs materialized), which the client feeds to a read-only editor.
  Optional `?diff=<baselineSeq>` (DOC only, `400` if not a non-negative integer; `0` = empty doc)
  additionally returns `diffJson` — a merged diff editorState (baseline → seq) with added/removed
  content wrapped in `diff-mark` nodes; without `?diff`, `diffJson` is `null`. (`502` if extraction
  fails or the rtc-server is too old to serve the render mode — deploy skew.)
  `200` (SHEET):
  ```json
  { "docId": "ckdo…", "type": "SHEET", "seq": 30, "headSeq": 42,
    "sheet": { "rows": [ { "rowId": "r1", "values": { "c1": "Ada", "c2": 7 } } ], "colTypes": { "c2": "number" } } }
  ```
  `200` (DOC):
  ```json
  { "docId": "ckdo…", "type": "DOC", "seq": 30, "headSeq": 42,
    "lexicalJson": "{\"root\":…}", "diffJson": null }
  ```
- `PATCH /api/documents/:id` — `{ title }` → rename. `title` 1–200 chars.
- `PATCH /api/documents/:id/move` — `{ folderId?, parentId? }` → relocate. `parentId` re-parents it
  under another document (clears `folderId`); `folderId` moves it into a folder (clears `parentId`);
  both `null`/omitted → workspace root. `parentId` wins if both are given. `400` on a self-parent or a
  cycle (moving a doc into its own subtree); `404` if the target folder/parent isn't in the workspace.
- `DELETE /api/documents/:id` — remove the document and its entire subdoc subtree →
  `{ ok: true, deleted: <count> }`.

### Document permissions (per-page grants)
Grant a **registered** user a role on **one specific document**, independent of workspace membership.
The **effective doc role** used by every read/write gate is `MAX(workspace-derived role, per-page grant)`
— a grant can only **elevate** access, never lower it (a `READ` grant on top of workspace `EDIT` changes
nothing). Any workspace role may be granted: `READ` | `COMMENT` | `EDIT` | `ADMIN` (`READ`/`COMMENT` →
view the page and mint **viewer** RTC tokens; `EDIT` → edit content (editor RTC token); `ADMIN` → also
rename / move / delete / manage permissions).
Grants **do not cascade** to sub-pages (lookups are by exact document id). A grantee who is not a
workspace member gets implicit read-only **guest** entry to the workspace shell, with the sidebar
filtered to their granted docs; `GET /api/documents/:id` collapses breadcrumbs to the doc itself so
ancestor titles don't leak. (`myRole` is added per document on list/get responses = the caller's
effective role, `ADMIN` for the owner.)

**Manage rights** = doc owner **OR** effective workspace `ADMIN` **OR** a doc-`ADMIN` grantee.
Non-managers get `403`; a missing doc is `404`.

- `GET /api/documents/:id/permissions` → `[{ userId, documentId, role, createdAt, user: { id, email, name, color } }]`.
  Requires manage rights.
- `POST /api/documents/:id/permissions` — `{ email, role: "READ" | "COMMENT" | "EDIT" | "ADMIN" }` →
  grant a role by email. Requires manage rights. **No realm enrollment** — the grant opens exactly
  this one doc, never realm-wide access. Side effect: a **"shared with you" notification email** (with
  a "View doc" button linking to the doc) is sent to them best-effort — mail failures never fail the
  request. `404` unknown
  email ("must register first") · `409` the email belongs to the doc owner · `409` the user already has a grant.
- `PATCH /api/documents/:id/permissions/:userId` — `{ role }` (same role values) → change a grant's
  role. Requires manage rights. `404` if there's no grant for that user. No email is sent.
- `DELETE /api/documents/:id/permissions/:userId` → `{ ok: true }`. Allowed for a manager **or** the
  grantee themselves (`actorId === userId`, i.e. "leave this page"). `404` if there's no such grant.

> Accepted leak: a guest streaming the workspace SSE feed sees title-level events for other docs in
> the workspace (metadata-only exposure).

### Share links (link-based access)
A document can have **at most one** share link — additive with per-page grants and workspace roles.
A link has a **scope** (`REALM` = any signed-in realm member with the link; `ANYONE` = works
logged-out, no auth) and a **role** (`READ` | `COMMENT` | `EDIT` — never `ADMIN`). The token is an
unguessable capability; a link never exposes anything about the workspace beyond the one doc.

Manage endpoints (same **manage rights** as permissions — owner / workspace `ADMIN` / doc-`ADMIN`):
- `GET /api/documents/:id/share-link` → `{ token, role, scope, createdAt, url }` (`url` =
  `${FRONTEND_URL}/link/:token`) or `404` if none.
- `PUT /api/documents/:id/share-link` — `{ role: "READ"|"COMMENT"|"EDIT", scope: "REALM"|"ANYONE" }` →
  upsert (creates if absent, else updates role/scope keeping the token). Returns the same shape.
- `POST /api/documents/:id/share-link/regenerate` → rotate the token (old URL dies immediately),
  keeping role/scope. `404` if no link.
- `DELETE /api/documents/:id/share-link` → `{ ok: true }` (idempotent revoke).
- `POST /api/documents/:id/refresh-access` → `{ ok: true, closed }` — force everyone currently in
  the doc to re-check access **now** instead of waiting out the ~5-min RTC token TTL. Closes all live
  RTC sockets on the doc and invalidates already-minted tokens — the rtc-server watermark is stamped
  from the backend clock (same clock that mints token `iat`, so no cross-service skew) and rejects any
  token with `iat <= watermark` (inclusive, so a token minted in the same second is also rejected), so
  each client reconnects by re-minting against current permissions; `closed` is the number of sockets
  dropped. Same **manage rights** as the share-link endpoints.

Public endpoints (**unguarded** — the token is the credential):
- `GET /api/share-links/:token` → `{ document: { id, title, icon, type, workspaceId }, role, scope }`.
  `ANYONE` scope needs no auth; `REALM` scope requires a signed-in realm member — no authenticated
  user → `401` ("sign in to open this link"), an authenticated non-member → `403` ("limited to members
  of the workspace's org"). `404` for an unknown token (constant — never reveals whether a token existed).
- `POST /api/share-links/:token/rtc-token` → `{ token, docId, role, name, color }` — mint an RTC token
  for the doc. `EDIT` link → `editor`, `READ`/`COMMENT` → `viewer`. Logged-out `ANYONE` visitors get a
  synthetic anonymous identity (random display name + presence color, echoed as `name`/`color`); an
  authenticated caller with stronger standing access (owner / workspace role / grant) keeps it.

---

## Uploads (object storage)

Pluggable object storage (`STORAGE_DRIVER`: `local` filesystem default, or `s3` for AWS S3 / MinIO /
R2). Max upload size is `STORAGE_MAX_UPLOAD_MB` (default 25 MB).

- `POST /api/uploads` — **guarded**. `multipart/form-data` with a single field **`file`**. `201` →
  `{ key, url, contentType, size }` where `url` is an absolute, browser-fetchable URL. Errors:
  `400` no file · `413` exceeds the size limit.
  ```bash
  curl -s localhost:4000/api/uploads \
    -H "Authorization: Bearer $ACCESS" \
    -F "file=@diagram.png"
  ```
  `201`:
  ```json
  {
    "key": "9f1c2e7a-3b4d-4e5f-8a9b-0c1d2e3f4a5b.png",
    "url": "http://localhost:4000/api/uploads/9f1c2e7a-3b4d-4e5f-8a9b-0c1d2e3f4a5b.png",
    "contentType": "image/png",
    "size": 20480
  }
  ```
- `GET /api/uploads/:key` — **public** (no auth) so it can back `<img src>`/downloads; keys are
  unguessable UUIDs. Streams the object with `Cache-Control: public, max-age=31536000, immutable`.
  `404` for an unknown or unsafe key. For the `s3` driver, prefer the absolute `url` returned by the
  upload response (public/CDN or pre-signed); this route still proxies it.

---

## Infra / well-known

### GET `/health`
`200` → `{ "status": "ok", "service": "backend" }`

### GET `/.well-known/rtc-jwks.json`
Public RS256 public JWK (for the rtc-server to verify RTC tokens later). Private key never leaves the backend.
`200` → `{ "keys": [ { "kty": "RSA", "kid": "rtc-key-1", "alg": "RS256", "use": "sig", "n": "…", "e": "AQAB" } ] }`

---

## Frontend integration sketch

```ts
const API = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";

type User = { id: string; email: string; name: string; color: string };
type Tokens = { accessToken: string; refreshToken: string; expiresIn: number; user: User };

export async function register(email: string, password: string, name: string): Promise<Tokens> {
  const res = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "register failed");
  return res.json();
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${API}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error("session expired");
  return res.json();
}

// Attach the access token; on 401, refresh once and retry.
export async function authedFetch(input: string, init: RequestInit, tokens: Tokens) {
  const withAuth = (t: string) => ({ ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  let res = await fetch(`${API}${input}`, withAuth(tokens.accessToken));
  if (res.status === 401) {
    const next = await refresh(tokens.refreshToken); // persist `next` for subsequent calls
    res = await fetch(`${API}${input}`, withAuth(next.accessToken));
  }
  return res;
}
```

Error shape (NestJS default): `{ "statusCode": 401, "message": "…", "error": "Unauthorized" }`.

curl smoke test:
```bash
curl -s localhost:4000/health
ACCESS=$(curl -s localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@toddle.test","password":"password123"}' | jq -r .accessToken)
curl -s localhost:4000/api/auth/me -H "Authorization: Bearer $ACCESS" | jq
```

---

## Running the tests

E2E (`backend/test/auth.e2e-spec.ts`) boots the real app against `DATABASE_URL` and covers every route + edge cases (validation bounds, wrong/expired/tampered/non-access tokens, deleted-user, refresh rotation + reuse, logout invalidation, no passwordHash leak).

```bash
pnpm db:up                                   # Postgres (or use a local instance)
cp .env.example .env                         # set DATABASE_URL + a real JWT_USER_SECRET (>=32 chars)
pnpm install --filter backend --filter @app/database
pnpm --filter @app/database generate
pnpm --filter @app/database migrate          # or: prisma db push (no migration files)
pnpm --filter @app/database seed             # demo users (password123)
pnpm --filter backend test:e2e
```
Tip: change `ACCESS_TOKEN_TTL_SEC` / `REFRESH_TOKEN_TTL_SEC` in `.env` to exercise short-expiry behaviour.
