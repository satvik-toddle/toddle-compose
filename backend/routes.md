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

> **Realm/workspaces:** not exposed. Realms are created **internally** (no public API) for now; workspace/RBAC endpoints come in the later RBAC phase (`docs/realm-workspace-rbac.md`).

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
