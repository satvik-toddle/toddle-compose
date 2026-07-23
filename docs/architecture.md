# Toddle Compose — System Architecture

> How the **frontend**, **backend**, and **rtc-server** fit together: identity, permissions, and the full life of a document edit and an image upload — in minute detail.

This document is the single reference for understanding the three services, their data models, the authorization model (who can read / create / edit / delete), and the exact sequence of events when a user opens a doc, types into it, or uploads an image.

---

## Table of contents

1. [The three services at a glance](#1-the-three-services-at-a-glance)
2. [Data model](#2-data-model)
3. [Identity & tokens](#3-identity--tokens-three-token-types)
4. [The permission model (read / create / edit / delete)](#4-the-permission-model)
5. [Frontend ↔ Backend interaction](#5-frontend--backend-interaction)
6. [Frontend ↔ RTC interaction (collaborative editing)](#6-frontend--rtc-interaction)
7. [Backend ↔ RTC interaction](#7-backend--rtc-interaction)
8. [Walkthrough: opening a document](#8-walkthrough-opening-a-document)
9. [Walkthrough: a user edits a document](#9-walkthrough-a-user-edits-a-document)
10. [Walkthrough: uploading an image](#10-walkthrough-uploading-an-image)
11. [Walkthrough: create / rename / move / delete](#11-walkthrough-create--rename--move--delete)
12. [Open workspace discovery & domain allowlist](#12-open-workspace-discovery--domain-allowlist)
13. [Persistence, history & compaction](#13-persistence-history--compaction)
14. [Environment & deployment reference](#14-environment--deployment-reference)

---

## 1. The three services at a glance

This is a **pnpm monorepo** (`packageManager: pnpm@9.12.3`) with three runtime services and shared packages.

| Service | Framework | Port (default) | Responsibility |
|---|---|---|---|
| **frontend** | React 18.3.1 + Vite 5.4 + TypeScript | `5173` (Vite dev) | SPA UI: auth, launcher, workspace, doc editor. Talks REST to backend, WebSocket to rtc-server. |
| **backend** | NestJS 10.4 + Prisma 7.8 (PostgreSQL) | `4000` | Source of truth for identity, realm/workspace/doc metadata, RBAC, file storage. Mints all tokens. |
| **rtc-server** | NestJS 10.4 + `ws` + `y-websocket` 2.0.4 + Yjs 13.6 | `4001` | Real-time collaborative editing engine. Holds live Yjs docs, broadcasts updates, persists CRDT state to its own DB. |

Shared packages (in `packages/`):
- `@app/database` — Prisma schema for the **app DB** (`packages/database/prisma/schema.prisma`): users, realm, workspaces, docs, folders, tokens.
- `@app/rtc-database` — Prisma schema for the **RTC DB** (`packages/rtc-database/prisma/schema.prisma`): Yjs snapshots + the append-only update log.

**The two databases are deliberately separate** and not joined by a foreign key. The app DB owns document *metadata and permissions*; the RTC DB owns document *content* (the Yjs CRDT state), keyed by `Document.id`.

### High-level topology

```
                         ┌───────────────────────────────────────────┐
                         │                FRONTEND (React SPA)         │
                         │  authStore (localStorage) · React Query     │
                         └───────┬───────────────────────────┬────────┘
              REST /api (Bearer) │                           │ WebSocket /yjs/:docId?token=…
                                 │                           │
                    ┌────────────▼───────────┐    ┌──────────▼──────────────┐
                    │       BACKEND (4000)    │    │     RTC-SERVER (4001)   │
                    │  NestJS · Prisma        │    │  NestJS · ws/y-websocket│
                    │  - auth, RBAC           │    │  - live Yjs docs        │
                    │  - doc/folder/ws CRUD   │    │  - broadcast + presence │
                    │  - file storage         │    │  - persist CRDT         │
                    │  - mints RTC tokens (RS256)  │  - verifies RTC token    │
                    │  - publishes JWKS       │◄───┤    via JWKS (RS256)     │
                    └───────┬─────────────────┘    └──────────┬──────────────┘
                            │   internal HTTP (X-Internal-Token)          │
                            │   POST /internal/docs/init, history, delete │
                            └─────────────────────────────────────────────┘
                                 │                           │
                         ┌───────▼────────┐         ┌────────▼─────────┐
                         │  APP DB (PG)   │         │  RTC DB (PG)     │
                         │ @app/database  │         │ @app/rtc-database│
                         └────────────────┘         └──────────────────┘
```

Three trust boundaries worth memorizing:
1. **Frontend → Backend**: HS256 access JWT in `Authorization: Bearer`.
2. **Frontend → RTC**: RS256 doc-scoped JWT in the WebSocket URL/subprotocol, minted by the backend.
3. **Backend → RTC**: shared-secret `X-Internal-Token` header on internal HTTP calls. (RTC never calls the backend except to fetch the public JWKS.)

---

## 2. Data model

App DB schema: `packages/database/prisma/schema.prisma`.

### Core entities

```
Realm (1) ──< RealmMember >── (n) User
  │                                │
  └──< Workspace                   ├──< Document   (ownerId)
         │                         ├──< Folder     (ownerId)
         ├──< WorkspaceMember >── User
         ├──< JoinRequest    >── User
         ├──< Folder
         └──< Document
```

| Model | Key fields | Notes |
|---|---|---|
| **Realm** | `id`, `name`, `allowedEmailDomains String[]` | Single realm per backend instance (pinned by `REALM_ID` env). The domain allowlist gates self-signup. |
| **RealmMember** | PK `(realmId, userId)`, `role: RealmRole` | `OWNER > MAINTAINER > MEMBER`. |
| **Workspace** | `id`, `realmId`, `name`, `visibility: PRIVATE\|PUBLIC`, `defaultRole: WorkspaceRole` | PUBLIC ⇒ any realm member self-joins as `defaultRole`. PRIVATE ⇒ request + approval. |
| **WorkspaceMember** | PK `(workspaceId, userId)`, `role: WorkspaceRole` | `READ < COMMENT < EDIT < ADMIN`. |
| **JoinRequest** | `workspaceId`, `userId`, `state: PENDING\|APPROVED\|REJECTED`, `requestedRole`, `decidedById` | Self-serve join lifecycle for PRIVATE workspaces. |
| **User** | `id`, `email` (unique), `passwordHash`, `name`, `color`, `emailVerifiedAt` | `emailVerifiedAt = null` blocks login until verified. `color` drives the collab cursor/avatar. |
| **RefreshToken** | `userId`, `tokenHash` (SHA256, unique), `expiresAt`, `revokedAt` | Rotating session token; raw value never stored. |
| **EmailVerificationToken / PasswordResetToken** | `tokenHash`, `expiresAt`, `consumedAt` | Single-use, short-lived links. |
| **Folder** | `id`, `name`, `icon`, `isPersonal`, `workspaceId`, `ownerId`, `parentId?`, `deletedAt?` | Self-referential tree, soft-delete. |
| **Document** | `id`, `title`, `icon`, `type: DOC\|SHEET`, `workspaceId`, `ownerId`, `folderId?`, `parentId?` | `parentId` enables sub-doc nesting. **Content is NOT here** — it lives in the RTC DB keyed by this `id`. |

### Enums

- **RealmRole** — `OWNER (2) > MAINTAINER (1) > MEMBER (0)` (cumulative).
- **WorkspaceRole** — `READ (0) < COMMENT (1) < EDIT (2) < ADMIN (3)` (cumulative).
- **Visibility** — `PRIVATE | PUBLIC` (workspace-level only).
- **DocumentType** — `DOC` (Lexical rich text) | `SHEET` (ds-data-grid).
- **JoinRequestState** — `PENDING | APPROVED | REJECTED`.

### RTC DB schema

`packages/rtc-database/prisma/schema.prisma` — two tables, keyed by `docId` (= app DB `Document.id`):

```prisma
model RtcDocument {
  id            String  @id            // doc ID
  yjsState      Bytes?                 // latest full CRDT snapshot (Y.encodeStateAsUpdate)
  version       Int     @default(0)    // bumped per snapshot flush
  updatedAt     BigInt                 // epoch ms
  snapshotAtSeq Int     @default(0)    // highest update seq folded into yjsState
}

model RtcDocumentUpdate {
  id         BigInt  @id @default(autoincrement())
  docId      String                    // no FK — cross-DB
  seq        Int                       // monotonic per doc
  updateBlob Bytes                      // a (coalesced) Yjs update
  byteLen    Int
  origin     String?                    // "live" | "session-compacted" | …
  clientSub  String?                    // user id (sub) that authored it
  createdAt  BigInt
  @@unique([docId, seq])
  @@index([docId, seq])
}
```

The current state of a doc = `yjsState` snapshot **+** replay of every `RtcDocumentUpdate` with `seq > snapshotAtSeq`.

---

## 3. Identity & tokens (three token types)

All tokens are minted by the **backend**. There are three distinct kinds.

### 3a. Access token (frontend → backend)
- **Algorithm**: HS256, signed with `JWT_USER_SECRET` (symmetric, ≥32 chars).
- **TTL**: `ACCESS_TOKEN_TTL_SEC`, default **900 s (15 min)**.
- **Claims**: `sub` (user id), `email`, `type: "access"`, `iss: compose-backend`, `aud: compose-api`, and optionally `activeWorkspaceId` (set when the user "enters" a workspace).
- **Transport**: `Authorization: Bearer <token>` header on every REST call.
- **Verified by**: `backend/src/auth/jwt-auth.guard.ts` — pins `iss`/`aud`/algorithm (anti-downgrade), checks `type === "access"`, then **re-loads the user from the DB by `sub`** so deleted users can't keep acting.

### 3b. Refresh token (frontend → backend, session continuity)
- **Format**: opaque random 32-byte base64url string. TTL `REFRESH_TOKEN_TTL_SEC`, default **86400 s (24 h)**.
- Only its SHA256 hash is stored (`RefreshToken.tokenHash`). **Rotating**: each `/auth/refresh` revokes the old row and issues a new one; reuse of a revoked token revokes the whole family (theft detection).
- The frontend persists **only the refresh token** (+ `lastActiveWorkspaceId`) to `localStorage` (`tc-auth`). The access token is short-lived and re-minted on boot.

### 3c. RTC token (frontend → rtc-server, per-document)
- **Algorithm**: RS256, signed with the backend's private key (`RTC_PRIVATE_KEY_PATH`, kid `rtc-key-1`).
- **TTL**: `RTC_TOKEN_TTL_SEC`, default **300 s (5 min)** ± 10% jitter.
- **Claims**: `docId`, `role` (`editor` | `viewer` | `denied`), `name`, `email`, `color`, `sub`, `iss: toddlecompose-backend`, `aud: rtc-server`.
- **Minted by**: `POST /api/documents/:id/rtc-token` — the backend resolves the user's *live* role against the doc (see §4) and bakes `editor`/`viewer` into the token.
- **Verified by rtc-server** against the backend's **JWKS** (`GET /.well-known/rtc-jwks.json`) using the `jose` library — no per-connection call back to the backend.

> **Key insight:** the RTC token freezes the permission decision at mint time. The rtc-server does not re-check the DB; it trusts the `role` claim. Because the token lives only ~5 min and the frontend silently re-mints it, a permission change propagates within one token lifetime.

---

## 4. The permission model

Two cumulative role ladders, combined with an **overlay** rule.

### 4a. Effective workspace role

`backend/src/realm/authz.service.ts → effectiveWorkspaceRole(userId, workspaceId)`:

```
effective role = MAX( direct WorkspaceMember.role , realm overlay )

realm overlay = ADMIN   if realm role is OWNER or MAINTAINER
              = (none)  otherwise
```

So a realm **OWNER/MAINTAINER acts as workspace ADMIN on every workspace**, even without a `WorkspaceMember` row. A plain `MEMBER` only has the role their `WorkspaceMember` grants (or none).

The frontend mirrors this exactly in `frontend/src/lib/roles.ts → effectiveWorkspaceRole(...)`, returning `{ role, overlay }` so the UI can show an "acting as admin" hint.

### 4b. What each role can do

| Capability | Required (non-owner) | Owner of the doc/folder |
|---|---|---|
| **List / read** docs in a workspace | workspace `READ` | always |
| **Open doc for editing (RTC `editor`)** | workspace `EDIT` or `ADMIN` | always |
| **Open doc read-only (RTC `viewer`)** | workspace `READ`/`COMMENT` | — |
| **Create** a doc / folder | workspace `EDIT` | — |
| **Rename / move** a doc | workspace `EDIT` | owner needs only `READ` |
| **Delete** a doc (cascades sub-docs) | workspace `ADMIN` | owner needs only `READ` |
| **Create a workspace** | realm `MAINTAINER` | — |
| **Update / delete a workspace, manage members** | workspace `ADMIN` | — |
| **Approve/reject join requests** | workspace `ADMIN` (or realm admin) | — |
| **Edit realm settings (domain allowlist)** | realm `OWNER` | — |
| **Manage realm members** | realm `OWNER` (for MAINTAINER), `MAINTAINER`+ (for MEMBER) | — |

### 4c. The actual enforcement code

The document checks live in `backend/src/documents/documents.service.ts`. The pattern: **owner gets a discount** (only needs workspace `READ`), everyone else needs the stated minimum.

**Read** (`requireDocRead`):
```ts
if (doc.owner.id === userId) return doc;                 // owner always reads
const role = await this.authz.effectiveWorkspaceRole(userId, doc.workspaceId);
if (role !== null) return doc;                           // any workspace member reads
throw new NotFoundException("document not found");       // 404, never reveals existence
```

**RTC role** (`resolveRtcRole`) — this is what decides `editor` vs `viewer` in the RTC token:
```ts
if (doc.owner.id === userId) return "editor";
const role = await this.authz.effectiveWorkspaceRole(userId, doc.workspaceId);
if (role === "ADMIN" || role === "EDIT") return "editor";
if (role === "READ"  || role === "COMMENT") return "viewer";
throw new ForbiddenException("no access to this document");
```

**Write/delete** (`requireDocWrite(userId, id, min)` with `min` = `"EDIT"` or `"ADMIN"`):
```ts
if (doc.owner.id === userId) {
  await this.authz.requireWorkspaceRole(userId, doc.workspaceId, "READ");   // owner discount
} else {
  await this.authz.requireWorkspaceRole(userId, doc.workspaceId, min);
}
```
- rename → `requireDocWrite(…, "EDIT")`
- move → `requireDocWrite(…, "EDIT")`
- delete → `requireDocWrite(…, "ADMIN")`
- create → `requireWorkspaceRole(…, "EDIT")`

> Every "not allowed to even see this" case throws **404 `NotFoundException`**, not 403 — so a private doc's existence is never leaked. Genuine "you can see it but can't do this" cases throw 403.

### 4d. Where each tier is enforced

- **Backend** = the authority. Every REST endpoint is behind `JwtAuthGuard` and then a role check; the RTC role is resolved here and signed into the token.
- **rtc-server** = trusts the signed `role` claim. A `viewer`'s edit frames are silently dropped at the socket (see §6/§9); a `denied` token is rejected at verification.
- **Frontend** = cosmetic gating only (hides buttons, sets `viewOnly`). It is never the security boundary — it cannot mint itself an `editor` token.

---

## 5. Frontend ↔ Backend interaction

### 5a. The HTTP client (`frontend/src/lib/http.ts`)
- Base URL: `apiUrl(path)` = `${VITE_API_BASE_URL}` + `/api` + path. `VITE_API_BASE_URL` is required in every mode; the dev default (`http://localhost:4000`) is committed in `frontend/.env.development`.
- Every request attaches `Authorization: Bearer <accessToken>` (unless `auth: false`).
- **401 → single-flight refresh → retry once**: concurrent 401s share one refresh promise to avoid token-rotation races. If a workspace scope was active, the refresh path also re-enters the workspace to restore the scoped token.
- FormData bodies are passed through untouched (so the browser sets the multipart boundary); JSON bodies are auto-stringified with `Content-Type: application/json`.

### 5b. Auth store & bootstrap (`frontend/src/stores/authStore.ts`)
- Zustand store with `persist` → `localStorage["tc-auth"]`, persisting `refreshToken` + `lastActiveWorkspaceId` only.
- On app load (`bootstrapAuth`): if a refresh token exists → mint a fresh access token → if `lastActiveWorkspaceId` set, `reEnter()` the workspace → `GET /auth/me` → `status: authed`. Any failure → `status: anon`.
- Cross-tab sync via `postMessage` (`lib/tabSync.ts`): logout/token changes broadcast to sibling tabs.

### 5c. Workspace scoping
- Entering a workspace: `POST /auth/workspace/enter { workspaceId }` → backend checks `READ` and returns a **new access token carrying `activeWorkspaceId`** + the user's role. The store records `activeWorkspaceId` and `activeRole`.
- `WorkspaceScopeRoute` guards `/w/:workspaceId` routes: if the token's scope ≠ the URL workspace, it enters scope before rendering.

### 5d. The REST surface (selected)

All under `/api`, all behind `JwtAuthGuard` unless noted.

| Area | Endpoint | Guard / min role |
|---|---|---|
| Auth | `POST /auth/register`, `/login`, `/verify-email`, `/refresh`, `/forgot-password`, `/reset-password` | public, rate-limited |
| Auth | `GET /auth/me`, `POST /auth/workspace/enter` / `leave` | authed (enter ⇒ workspace READ) |
| Realm | `GET /realm`, `PATCH /realm` | read: any; patch: realm OWNER |
| Realm | `GET/POST/PATCH/DELETE /realm/users…` | realm MAINTAINER/OWNER (role-dependent) |
| Workspaces | `GET /workspaces`, `POST /workspaces` | list: any; create: realm MAINTAINER |
| Workspaces | `GET /workspaces/discoverable` | any realm member |
| Workspaces | `POST /workspaces/:id/join` / `/requests` / `…/approve` / `…/reject` | join: public+member; approve/reject: workspace ADMIN |
| Workspaces | `GET/PATCH/DELETE /workspaces/:id`, `…/users…` | read: READ; manage: ADMIN |
| Folders | `GET /folders` (READ), `POST` (EDIT), `PATCH/DELETE /folders/:id` (owner+READ or ADMIN) | as noted |
| **Documents** | `GET /documents` (READ), `POST` (EDIT) | as noted |
| Documents | `GET /documents/:id`, `/subdocs`, `/hierarchy`, `/history`, `/history/:seq` | READ (hierarchy needs workspace READ) |
| Documents | `POST /documents/:id/rtc-token` | resolves editor/viewer |
| Documents | `PATCH /documents/:id` (EDIT), `/move` (EDIT), `DELETE` (ADMIN) | as noted |
| Uploads | `POST /uploads` (authed), `GET /uploads/:key` (public, unguessable key) | as noted |
| Realtime | `GET /realtime/workspaces/:id/stream?token=…` | workspace READ (SSE) |

### 5e. Live workspace events (SSE)
Separate from RTC. `backend/src/realtime/` is an in-memory RxJS pub/sub. After any doc write, the backend emits `document.created|updated|deleted` to subscribers of that workspace's SSE stream (`GET /api/realtime/workspaces/:id/stream?token=…`, token in query param because `EventSource` can't set headers). This keeps **sidebars and doc lists** fresh across clients — it does **not** carry document content (that's RTC's job). 25 s heartbeat; per-instance only (needs Redis fan-out to scale horizontally).

---

## 6. Frontend ↔ RTC interaction

### 6a. The editor
- The editor is `@toddle-edu/ds-doc-editor` (Lexical-based, **symlinked prebuilt** package — rebuild it to propagate source changes).
- Mounted in `frontend/src/features/workspace/DocEditor.tsx`, keyed by `docId` so it fully remounts per document.
- `main.tsx` exposes `window.React`/`window.ReactDOM` for the editor's UMD collaboration bundle.

### 6b. Getting the RTC token
`useRtcToken(docId)` (React Query) calls `POST /api/documents/:id/rtc-token`. Config: `staleTime: 4 min` (shorter than the 5-min token TTL so it refreshes *before* expiry), `gcTime: 0`. Response `{ token, docId, role }`.

### 6c. The y-websocket provider
```ts
new WebsocketProvider(RTC_WS_URL, docId, yDoc, {
  params: paramsRef.current,   // { token }
  connect: false,              // Lexical's CollaborationPlugin drives connect/disconnect
});
```
- `RTC_WS_URL` from `VITE_RTC_WS_URL` (required; dev default `ws://localhost:4001/yjs` in `frontend/.env.development`), normalized to end in `/yjs`. The provider appends the room → final URL `ws://host:4001/yjs/<docId>?token=<rtcToken>`.
- `username` = user's name, `cursorColor` = user's `color` — these feed Yjs **awareness** (presence cursors).
- `viewOnly={rtc.role !== 'editor'}` puts the editor into read-only mode for viewers.

### 6d. Token refresh without dropping the socket
`paramsRef` is a stable object held across renders. When `useRtcToken` refetches (~every 4 min), it mutates `paramsRef.current.token` in place, so the provider's next (re)connect uses the new token — the Y.Doc and provider are not torn down, so editing is uninterrupted.

### 6e. Connection handshake on the rtc-server (`rtc-server/src/yjs/yjs-server.service.ts`)
1. **URL parse** — extract `docId` from `/yjs/:docId` and `token` from `?token=` (or the `bearer.<token>` WebSocket subprotocol). Bad shape → 400.
2. **`verifyClient`** — `TokensService.verify(token)`: `jwtVerify` against the JWKS with `issuer`/`audience` pinned and `algorithms: ["RS256"]`. Validates `sub`/`docId`/`role`. `role: "denied"` → reject. Then asserts the **token's `docId` matches the URL** → else 403. Claims stashed on the request.
3. **`connection`** — claims re-read (fail-closed if missing → close 1008). An **expiry timer** is armed from the JWT `exp`; when it fires the socket is closed `1008 "token expired"`.
4. **`setupWSConnection(ws, req, { docName: docId, gc: true })`** — hands off to y-websocket's standard Yjs sync protocol (sync-step-1/2 + live updates + awareness).

---

## 7. Backend ↔ RTC interaction

The backend is the only initiator; the rtc-server's only outbound call is fetching the JWKS.

- **JWKS**: rtc-server builds `createRemoteJWKSet(JWKS_URL)` (default `http://localhost:4000/.well-known/rtc-jwks.json`) and caches it to verify RTC token signatures.
- **Internal HTTP** (`backend/src/rtc/rtc-internal.client.ts` → `RTC_INTERNAL_URL`, default `http://localhost:4002`), authenticated with the `X-Internal-Token` shared secret (timing-safe compared in `rtc-server/src/internal/internal-token.guard.ts`):
  - `POST /internal/docs/init { docId }` — idempotently provision the RTC row.
  - `GET /internal/docs/:docId/sessions` — edit-session history (powers `GET /api/documents/:id/history`).
  - `GET /internal/docs/:docId/versions/:seq` — reconstruct doc state at a seq (powers history snapshots).
  - `DELETE /internal/docs/:docId` — drop RTC state when a doc is deleted.
- These calls are **best-effort** with 3–8 s timeouts; failures are logged, not fatal.

> Note: `RTC_INTERNAL_URL` (4002) is the backend→RTC internal HTTP base, while clients hit the RTC WebSocket on `RTC_PORT` (4001). Configure both to point at the same rtc-server deployment.

---

## 8. Walkthrough: opening a document

```
User → /w/{workspaceId}?doc={docId}
  │
  1. WorkspaceScopeRoute: is the access token scoped to {workspaceId}?
  │     └─ no → POST /api/auth/workspace/enter {workspaceId}
  │            backend checks workspace READ → returns scoped access token + role
  │
  2. WorkspaceLayout: GET /api/workspaces/{id}  +  GET /api/realm
  │     → compute effective role (realm overlay if OWNER/MAINTAINER) → WorkspaceCtx
  │
  3. PagesPanel: GET /api/documents?workspaceId={id}   (needs workspace READ)
  │
  4. DocEditor mounts (key=docId):
  │     └─ useRtcToken(docId): POST /api/documents/{docId}/rtc-token
  │            backend resolveRtcRole() → "editor" | "viewer" → RS256 token
  │            response { token, docId, role }
  │
  5. Lexical CollaborationPlugin → providerFactory → new WebsocketProvider(
  │        ws://rtc:4001/yjs/{docId}?token={rtcToken} )  → provider.connect()
  │
  6. rtc-server verifyClient: jose verify (JWKS, iss/aud/RS256) + docId match
  │     → connection accepted; expiry timer armed from exp
  │
  7. bindState(docId): cold-load from RTC DB
  │     yjsState snapshot + replay updates where seq > snapshotAtSeq → in-memory Y.Doc
  │
  8. Yjs sync-step-1/2 brings the client to current state; editor renders.
  │     viewOnly = (role !== 'editor')
  └─ Awareness: name + color broadcast → collaborators' cursors appear.
```

---

## 9. Walkthrough: a user edits a document

```
Client (editor types)
  │ Lexical change → @lexical/yjs binding → Yjs update → y-websocket msg
  │ (sync msg type 0, subtype 2) over the WebSocket
  ▼
rtc-server message handler (yjs-server.service.ts)
  │ • token-bucket rate limit per connection
  │ • if role === "viewer" AND frame is syncStep2/update → DROP silently  ← write block
  │ • awareness frames (type 1) coalesced (latest wins, ~100ms trailing)
  ▼
y-websocket setupWSConnection → Y.Doc.applyUpdate()  (CRDT merge in memory)
  ├─► broadcast update to all other peers on this docId → their editors update live
  └─► server-side ydoc.on("update") fires:
        • buffer into pendingAppend, coalesced per (origin, clientSub)
        • arm checkpoint timer; schedule debounced flush
  ▼
Persistence (doc-state.service.ts → doc-repository.service.ts)
  • bufferAppend: flush when ≥200 updates / ≥256 KB / 250 ms timer
  • appendDocUpdate: tx { seq = MAX(seq)+1; INSERT RtcDocumentUpdate(blob, origin, clientSub) }
  • debounced snapshot flush (idle 2 s / max 10 s):
        UPDATE RtcDocument SET yjsState = Y.encodeStateAsUpdate(ydoc),
                               snapshotAtSeq = lastSeq, version++
  • on last disconnect (writeState): checkpoint + final flush + compaction + evict Y.Doc
```

Key points:
- **Conflict resolution is pure Yjs CRDT** — no server-side merge logic. Concurrent edits converge deterministically.
- **Viewer enforcement is at the socket frame level**: a viewer's awareness/cursor still flows (so they show presence), but any state-changing sync frame is dropped. The role was decided by the backend and frozen in the token.
- **Authorship** is captured via `clientSub` (from the token's `sub`, mapped from the originating WebSocket), enabling per-author history.

---

## 10. Walkthrough: uploading an image

```
User pastes / drags / inserts an image in the editor
  ▼
ds-doc-editor calls uploadToServer(arg)   (wired in DocEditor.tsx)
  │  arg = File | Blob | { file, attachment }; filename derived from name/MIME
  ▼
uploadFile(file, name)  (frontend/src/api/uploads.ts)
  │  FormData field "file" → http.post('/uploads')  (Bearer attached, multipart boundary kept)
  ▼
POST /api/uploads  (backend, JwtAuthGuard, multipart) — storage/uploads.controller.ts
  │  • size checked vs STORAGE_MAX_UPLOAD_MB (default 25)
  │  • active content (html/svg/js) downgraded to application/octet-stream
  │  • local driver: write ./.storage/<uuid>.<ext>;  S3 driver: putObject
  │  → { key, url, contentType, size }
  ▼
Editor sets the image node src = returned url
  ▼
That src is part of the Lexical/Yjs document → syncs to all peers via RTC
  → every collaborator renders the same image URL
  ▼
GET /api/uploads/:key  (public, no auth, unguessable UUID key)
  • Cache-Control: public, max-age=1y, immutable
  • X-Content-Type-Options: nosniff; inline-safe types inline, others attachment
```

URL formation:
- **Local driver**: `url = ${BACKEND_PUBLIC_URL}/api/uploads/<key>`. ⚠️ **`BACKEND_PUBLIC_URL` must be the externally reachable origin** — it gets embedded in the doc content and served to every collaborator. If it points at `localhost` in a deployed setup, remote peers get broken images.
- **S3 driver**: absolute `STORAGE_S3_PUBLIC_URL/<key>` if configured, else a pre-signed GET URL (default 1 h TTL).

The returned URL is absolute, so the frontend uses it verbatim as the node `src` — no client-side rewriting.

---

## 11. Walkthrough: create / rename / move / delete

| Action | Endpoint | Permission | Side effects |
|---|---|---|---|
| **Create doc** | `POST /api/documents` | workspace `EDIT` | creator = owner; on first RTC open, backend `POST /internal/docs/init`. Emits `document.created` SSE. |
| **Rename** | `PATCH /api/documents/:id` | `EDIT` (owner: `READ`) | title change; emits `document.updated` SSE. |
| **Move** | `PATCH /api/documents/:id/move` | `EDIT` (owner: `READ`) | re-parent/re-folder; blocks cross-workspace moves & cycles. |
| **Delete** | `DELETE /api/documents/:id` | `ADMIN` (owner: `READ`) | cascade-deletes sub-doc subtree; backend `DELETE /internal/docs/:id` clears RTC state; emits `document.deleted`. Returns `{ ok, deleted: <count> }`. |

The SSE events (§5e) let other clients' sidebars update without a manual refresh.

---

## 12. Open workspace discovery & domain allowlist

(The feature set on branch `feat/open-workspace-discovery-and-domain-allowlist`.)

### Domain allowlist (self-signup gate)
- `Realm.allowedEmailDomains: string[]`. Edited by a realm **OWNER** via `PATCH /api/realm { allowedEmailDomains }` (UI: `RealmSettingsTab.tsx`, OWNER-only; domains normalized lowercase, `@` stripped, chip UI).
- Enforced at registration (`backend/src/auth/auth.service.ts → assertEmailDomainAllowed`):
  ```ts
  if (allowed.length === 0) return;                 // empty ⇒ open registration
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !allowed.includes(domain))
    throw new ForbiddenException("this email isn't authorised to join this realm");
  ```

### Open workspace discovery (self-join)
- `GET /api/workspaces/discoverable` (any realm member) lists workspaces the user is **not already in**:
  ```ts
  where: { realmId: this.realm.id, members: { none: { userId } } }
  ```
- Frontend `RequestAccessPage.tsx`:
  - **PUBLIC** workspace → "Open" → `POST /workspaces/:id/join` → auto-joins as `defaultRole` (and ensures a realm MEMBER row) → auto-enter.
  - **PRIVATE** workspace → "Request access" → `POST /workspaces/:id/requests` (state `PENDING`, optional `requestedRole`) → UI polls; on `APPROVED`, auto-enters.
- A workspace **ADMIN** (or realm admin) sees pending requests and approves/rejects (`…/requests/:rid/approve|reject`); approval atomically creates the `WorkspaceMember` and marks the request `APPROVED`. Last-ADMIN demotion/removal is blocked.

---

## 13. Persistence, history & compaction

- **Cold load** (`bindState`): snapshot + tail-replay reconstructs the live Y.Doc on first connect. New docs are seeded with a baseline update.
- **Snapshot vs log**: the append-only `RtcDocumentUpdate` log is the durable record; periodic snapshots (`RtcDocument.yjsState` + `snapshotAtSeq`) bound replay length.
- **History** (`rtc-server/src/history/`): updates are grouped into per-author **sessions** by time gaps. `GET /api/documents/:id/history` returns sessions (names/colors resolved from the app DB via `clientSub`); `GET /api/documents/:id/history/:seq` reconstructs the doc at a seq and extracts kind-specific output (Lexical JSON + plainText for `DOC`, rows + colTypes for `SHEET`).
- **Lexical extraction** is done headless on the server (`lexical-extract.*`) via a worker pool, binding Yjs → a Lexical editor with the bundled server nodes (namespace `ds-doc-editor-collab`) — used only for preview/history, never for live editing.
- **Compaction** (`rtc-server/src/compaction/`): Tier 1 (>7 days) merges per-session updates; Tier 2 (>30 days) merges everything into one blob (`origin: "session-compacted"`). Runs on disconnect and on a scheduler.
- **Single-writer assumption**: `seq` is allocated as `MAX(seq)+1` in a transaction, so a given doc must be served by one rtc-server instance (doc→instance affinity required to scale horizontally).

---

## 14. Environment & deployment reference

### Backend (`backend/src/config/env.ts`)
| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | App DB (PostgreSQL). |
| `REALM_ID` | — (required) | The single realm this instance serves. |
| `BACKEND_PORT` | 4000 | HTTP port. |
| `JWT_USER_SECRET` | — (≥32) | Signs HS256 access tokens. |
| `ACCESS_TOKEN_TTL_SEC` / `REFRESH_TOKEN_TTL_SEC` | 900 / 86400 | Token lifetimes. |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins (no wildcard). |
| `FRONTEND_URL` | `http://localhost:5173` | Base for email links. |
| `INTERNAL_TOKEN` | — (≥32) | Shared secret for backend→RTC internal HTTP. |
| `RTC_INTERNAL_URL` | `http://localhost:4002` | rtc-server internal HTTP base. |
| `RTC_TOKEN_TTL_SEC` | 300 | RTC token lifetime (±10% jitter). |
| `RTC_TOKEN_ISS` / `RTC_TOKEN_AUD` | `toddlecompose-backend` / `rtc-server` | RTC token issuer/audience. |
| `RTC_PRIVATE_KEY_PATH` | `./.keys/rtc-private.pem` | RS256 key for RTC tokens (JWKS published at `/.well-known/rtc-jwks.json`). |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. |
| `STORAGE_MAX_UPLOAD_MB` | 25 | Upload size cap. |
| `BACKEND_PUBLIC_URL` | `http://localhost:4000` | **Externally reachable** base for local-driver upload URLs. |
| `STORAGE_S3_*` | — | Bucket/region/endpoint/creds/public-url for S3 driver. |
| email: `EMAIL_SERVICE_TYPE` | `nodemailer` | Transport switch: `nodemailer` (Gmail/console) or `resend`. |
| email: `GMAIL_SERVICE_EMAIL` / `GMAIL_SERVICE_PASSWORD` | — | Gmail SMTP creds; required in prod when `EMAIL_SERVICE_TYPE=nodemailer` unless `BYPASS_EMAIL_SERVICE=true`. |
| email: `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | — | Resend key (required in prod when `EMAIL_SERVICE_TYPE=resend` unless bypassed) + verified sender (defaults to `onboarding@resend.dev`). |

### rtc-server (`rtc-server/src/config/env.ts`)
| Var | Default | Purpose |
|---|---|---|
| `RTC_PORT` | 4001 | Shared HTTP + WebSocket port. |
| `RTC_DATABASE_URL` | — (required) | RTC DB (PostgreSQL). |
| `JWKS_URL` | `http://localhost:4000/.well-known/rtc-jwks.json` | Backend public keys for token verification. |
| `RTC_TOKEN_ISS` / `RTC_TOKEN_AUD` | match backend | Verified on every connection. |
| `INTERNAL_TOKEN` | — (≥32) | Must match the backend's. |
| debounce/compaction knobs | see code | `RTC_DEBOUNCE_IDLE_MS` 2000, `RTC_DEBOUNCE_MAX_MS` 10000, append-coalesce 250 ms / 200 updates / 256 KB, checkpoint 300 s. |

### Frontend (`frontend/src/lib/env.ts`, `vite-env.d.ts`)
| Var | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000` (frontend/.env.development) | Backend origin; required in every mode, build fails if unset. |
| `VITE_RTC_WS_URL` | `ws://localhost:4001/yjs` (frontend/.env.development) | RTC WebSocket base (normalized to end in `/yjs`); required, build fails if unset. |

---

### One-paragraph summary

The **frontend** authenticates against the **backend** with a short-lived HS256 access token (refresh-token rotation keeps the session alive) and reads all metadata/permissions over REST. To edit a document it asks the backend for a per-doc **RS256 RTC token** that encodes `editor`/`viewer` based on the user's effective workspace role (a realm OWNER/MAINTAINER overlays as ADMIN everywhere; the doc owner gets a discount). It opens a WebSocket to the **rtc-server**, which verifies that token against the backend's JWKS and then runs the Yjs CRDT sync protocol — applying edits, broadcasting to peers, dropping write frames from viewers, and persisting a snapshot-plus-update-log to its own database. Images are uploaded to the backend's `/api/uploads`, and the returned absolute URL is embedded in the Yjs document so every collaborator sees the same image. The backend and rtc-server share no database; they communicate only via the public JWKS and a shared-secret internal HTTP API used for doc init, history, and deletion.
