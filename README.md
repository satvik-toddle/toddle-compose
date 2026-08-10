# Toddle Compose

Collaborative document app — a pnpm monorepo. Documents live in workspaces with
realm/workspace RBAC; real-time editing is Yjs over WebSocket, persisted in a
separate write-heavy database.

## Architecture

| Component | Port | Purpose |
|-----------|------|---------|
| **backend/** | `:4000` | NestJS HTTP API (`/api`). Auth (JWT access + refresh), realm/workspace RBAC, folders, documents. Mints the **RS256 RTC tokens** and serves the **JWKS** the rtc-server verifies against. |
| **rtc-server/** | `:4001` WS · `:4002` internal | NestJS Yjs collaboration server. Verifies RTC tokens via JWKS, enforces editor/viewer, persists Yjs updates + snapshots, runs tiered compaction. Internal HTTP API (shared-secret) for provisioning + history. |
| **frontend/** | `:5173` | Vite + React app (consumes `@toddle-edu/ds-doc-editor`). |
| **packages/database** | — | `@app/database` — app Prisma client (users, realms, workspaces, folders, documents). DB: `toddle_compose`. |
| **packages/rtc-database** | — | `@app/rtc-database` — Prisma client for the **separate** RTC store (`RtcDocument`, `RtcDocumentUpdate`). DB: `toddle_compose_rtc`. No FK to the app DB by design. |

### How a document gets edited

1. `POST /api/documents` → backend creates the doc and best-effort provisions its RTC
   row in the rtc DB (rtc-server also lazily creates it on first connect).
2. `POST /api/documents/:id/rtc-token` → backend checks access and returns a short-lived
   **RS256 JWT** with claims `{ docId, role: editor|viewer, name, email, color }`
   (403 if no access — "denied" is never minted).
3. Client connects `ws://localhost:4001/yjs/:docId?token=…` → rtc-server verifies the
   token via the backend JWKS, enforces the role (**viewer writes are dropped**), and
   persists updates to `toddle_compose_rtc`.

**Access model:** folders/documents are workspace-scoped. Read = workspace `READ`
(members + workspace `ADMIN` + the realm `OWNER`/`MAINTAINER` → `ADMIN` overlay).
Create needs `EDIT`; rename/move need `EDIT`; visibility/delete need owner or `ADMIN`.
A `PUBLIC` document is also readable by any realm member. Deleted folders are
**soft-deleted** (hidden immediately, hard-purged after 30 days by a daily cron).

## Prerequisites

- Node `>=20`, pnpm `9` (`corepack enable`)
- Docker (Postgres)
- `GITHUB_TOKEN` exported — only to install `@toddle-edu/*` (the frontend editor)

## Setup

```bash
cp .env.example .env                 # set JWT_USER_SECRET (≥32 chars: openssl rand -hex 32)
pnpm db:up                           # Postgres 16; creates BOTH databases on first boot
pnpm install
pnpm db:push                         # push @app/database + @app/rtc-database schemas
pnpm db:init                         # realm + OWNER from env (prod-safe; required to boot the backend)
pnpm db:seed                         # demo users (alice@…, password: password123) — LOCAL only
```

## Run

```bash
pnpm dev                # backend + rtc-server + frontend together
# — or individually —
pnpm dev:backend        # :4000  HTTP API
pnpm dev:rtc            # :4001 WS + :4002 internal
pnpm dev:frontend       # :5173
```

Routes are under `/api`; `GET /health` and `GET /.well-known/rtc-jwks.json` are unprefixed.

## Test

```bash
pnpm test                       # backend e2e: auth · realm · workspaces · folders · documents (needs DB up)
node tests/rtc-multiuser.cjs    # RTC: multi-user convergence, viewer write-drop, persistence
#                                 (needs backend :4000 + rtc-server running)
```

`backend/api.http` is a ready-to-run request collection (JetBrains/VS Code REST Client);
`tests/TEST-PLAN.md` lists the covered scenarios.

## Databases

Two Postgres databases on one instance (both created by `docker/postgres-init` on first
`db:up`):

- `DATABASE_URL` → `toddle_compose` (app: auth, RBAC, folders, documents)
- `RTC_DATABASE_URL` → `toddle_compose_rtc` (write-heavy Yjs update log + snapshots)

Edit `packages/*/prisma/schema.prisma`, then `pnpm db:push` (or `db:generate`).

## Notes

- **Secrets:** `JWT_USER_SECRET` required (no default); the RS256 RTC keypair is generated
  on first backend boot into `./.keys/` (gitignored); `INTERNAL_TOKEN` guards the
  backend↔rtc internal API.
- **doc-editor / `vendor/`:** the rtc-server extracts text via the editor's server nodes,
  pre-bundled to `rtc-server/vendor/server-nodes.cjs` (gitignored — regenerate with
  `pnpm --filter rtc-server bundle:nodes`, which needs the `doc-editor` checkout). Lexical/Yjs
  must resolve to a single instance — see the `pnpm.overrides` in root `package.json`.

## Tooling

| Command | Does |
|---------|------|
| `pnpm lint` / `format` / `typecheck` | ESLint · Prettier · per-package `tsc --noEmit` |
| `pnpm db:up` / `db:down` | start / stop Postgres |
| `pnpm db:push` / `db:init` / `db:seed` / `db:generate` | sync schemas · realm+owner bootstrap · demo users · regenerate clients |
