# Backend API — Routes (Phase 1: auth + users)

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

- `POST /api/auth/workspace/enter` — `{ workspaceId }` → `{ accessToken, expiresIn, workspaceId, role }`.
  `403` if you have no access to the workspace · `404` if it isn't in this realm.
- `POST /api/auth/workspace/leave` — → `{ accessToken, expiresIn, workspaceId: null }`.

### Realm
- `GET /api/realm` → `{ id, name, role }` (`role` is your realm role, or `null` if not a member).
- `GET /api/realm/users` → `[{ user, role, createdAt }]`. Requires realm `MEMBER`+. `?skip&?take`.
- `POST /api/realm/users` — `{ email, role: "MAINTAINER" | "MEMBER" }` → add an existing user.
  `MAINTAINER`+ required; granting `MAINTAINER` is **owner-only**. `OWNER` is not assignable.
  `404` unknown email · `409` already a member · `400` invalid role (incl. `OWNER`).
- `PATCH /api/realm/users/:userId` — `{ role }` → change role (owner-only for anything touching a
  `MAINTAINER`). Cannot target/produce `OWNER`.
- `DELETE /api/realm/users/:userId` — remove from realm. Cannot remove the `OWNER`.

### Workspaces
Each workspace has a `visibility` (`PUBLIC` → anyone in the realm self-joins as `defaultRole`;
`PRIVATE` → request + approval) and a `defaultRole` (default `READ`).

- `GET /api/workspaces` → realm admins see all; members see their own. `[]` when none. `?skip&?take`.
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
- `GET /api/workspaces/:id/users` → `[{ user, role }]`. Requires `READ`+.
- `POST /api/workspaces/:id/users` — `{ email, role: READ|COMMENT|EDIT|ADMIN }` → add an existing user
  (requires `ADMIN`). Side effect: the user is ensured to be at least a realm `MEMBER`. `404` unknown
  email · `409` already a member.
- `PATCH /api/workspaces/:id/users/:userId` — `{ role }` → requires `ADMIN`.
- `DELETE /api/workspaces/:id/users/:userId` — requires `ADMIN`; refuses to remove the **last** `ADMIN` (`409`).

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
