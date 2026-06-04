# Toddle Compose

Collaborative document app — greenfield build. Four components (built in later phases):

- **backend/** — NestJS HTTP API (`:4000`)
- **rtc-server/** — NestJS Yjs WebSocket collab (`:4001`) + internal HTTP (`:4002`)
- **frontend/** — Vite + React workspace (`:5173`)
- **packages/** — shared packages (e.g. `@app/database` Prisma client)

The build roadmap lives in Coda. This repo currently contains **Phase 0 · Foundation** only:
the pnpm monorepo scaffold, shared tooling, and the Postgres container.

## Prerequisites

- Node `>=20`
- pnpm `9` (`corepack enable` picks up the pinned `packageManager`)
- Docker (for Postgres)
- `GITHUB_TOKEN` exported — required to install `@toddle-edu/*` packages from GitHub Packages

## Setup

```bash
# 1. Environment
cp .env.example .env            # adjust secrets as needed

# 2. Database (Postgres 16 in Docker)
pnpm db:up                      # docker compose up -d postgres
#   → postgresql://toddle:toddle@localhost:5432/toddlecompose

# 3. Install (once workspace packages exist)
pnpm install
```

## Backend (Phase 1 · auth + user creation)

NestJS API on `:4000` with email/password auth (**access + refresh tokens**) and a
shared Prisma database package. Implemented modules: **Config · Prisma · Keys (JWKS) ·
Auth**. Full route/payload reference for frontend integration:
**[`backend/routes.md`](backend/routes.md)**.

**Auth model:** short-lived **access JWT** (`ACCESS_TOKEN_TTL_SEC`, default 15 min) +
longer-lived **refresh token** (`REFRESH_TOKEN_TTL_SEC`, default 24 h) that is persisted
hashed, **rotating**, and **revocable**. Endpoints: `register`, `login`, `refresh`,
`logout`, `me`. Passwords hashed with bcrypt (cost 12).

### Run it

```bash
cp .env.example .env                              # see "Files to change" below
pnpm db:up                                        # Postgres 16 in Docker

# backend + database only (skips frontend/rtc, so no GITHUB_TOKEN needed)
pnpm install --filter backend --filter @app/database
pnpm --filter @app/database generate              # prisma client → packages/database/generated
pnpm --filter @app/database migrate               # create tables (fresh DB)
pnpm --filter @app/database seed                  # demo users, password: password123

pnpm dev:backend                                  # http://localhost:4000
pnpm --filter backend test:e2e                    # e2e: every auth/users route (needs DB up)
```

### Files to change

| File | Change |
|------|--------|
| `.env` | copy from `.env.example`; set `DATABASE_URL` and a **real `JWT_USER_SECRET` (required, ≥32 chars** — `openssl rand -hex 32`). Optional: `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_SEC`, `CORS_ORIGINS`. |
| `packages/database/prisma/schema.prisma` | source of truth for the data model; re-run `generate` + `migrate`/`db push` after edits. |
| `packages/database/prisma/seed.ts` | demo users / shared login password. |
| `backend/src/config/env.ts` | add an env var here (zod-validated) before using it in a module. |

### Notes

- Routes: app routes under `/api`; `GET /health` and `GET /.well-known/rtc-jwks.json` are unprefixed.
- Access tokens are Bearer JWTs (HS256); refresh tokens are opaque, rotating, revocable (table `refresh_tokens`).
- Security: `JWT_USER_SECRET` is **required** (no insecure default); CORS is restricted to `CORS_ORIGINS` (no wildcard); bcrypt cost 12. Token lifetimes are env-tunable.
- The RS256 JWKS endpoint exists for the rtc-server to consume later — the keypair is generated on first boot into `./.keys/` (gitignored).
- **Realms are created internally — no public API** for them yet; workspace/RBAC endpoints land in the RBAC phase (`docs/realm-workspace-rbac.md`).

## Doc-editor integration (`@toddle-edu/ds-doc-editor`)

The collaborative editor is **not** built in this repo — it lives in the separate
[`doc-editor`](https://github.com/satvik-toddle) monorepo and is consumed as a package.

- **Package name:** `@toddle-edu/ds-doc-editor` (currently `0.8.1`)
- **Local checkout:** `/Users/apple/Documents/doc-editor/packages/doc-editor`
- **Branch to use:** `temp/lexical-yjs` (the Lexical + Yjs collab line)
- **Exports:** `.` → `dist/main.js` (browser bundle, consumed by **frontend**),
  `./server` → `src/nodes/AllNodesServer.js` (server node classes, consumed by **rtc-server**)
- **Pinned deps:** Lexical `0.30.0`, React 17 (peer). Yjs / `@lexical/*` must resolve to a
  **single instance** across this repo and the editor, or collab silently breaks.

```bash
# in the doc-editor repo
cd /Users/apple/Documents/doc-editor
git checkout temp/lexical-yjs
```

### Which files to change in this repo

| File | Change |
|------|--------|
| `frontend/package.json` | add `"@toddle-edu/ds-doc-editor": "workspace:*"` (or the published `^0.8.1`) to `dependencies` |
| `rtc-server/package.json` | add the same dep — needed for the `/server` export (server-side Lexical extraction) |
| `package.json` (root) | add the `pnpm.overrides` block below to link the local branch + pin Lexical/Yjs to one instance |
| `.npmrc` | already wired — used only when installing the **published** version from GitHub Packages (needs `GITHUB_TOKEN`) |

### Pinning Lexical / Yjs to a single instance

Yjs and Lexical **must resolve to exactly one physical copy** across this repo and the
editor — two copies break CRDT convergence (`Type … is not registered`, failed sync).
Pin the versions doc-editor uses via plain version overrides and let pnpm dedupe to one
copy in the store (CI-safe, no sibling-path coupling):

```jsonc
// package.json (root) → "pnpm": { "overrides": { ... } }
{
  "pnpm": {
    "overrides": {
      "lexical": "0.30.0",
      "@lexical/react": "0.30.0",
      "@lexical/yjs": "0.30.0",
      "yjs": "13.6.27",
      "y-websocket": "2.0.4"
    }
  }
}
```

> Add **every** `@lexical/*` subpackage you actually import (code, list, rich-text, table,
> utils, selection, history, markdown, …), all pinned to `0.30.0`. These versions track the
> `temp/lexical-yjs` branch of doc-editor — bump them in lockstep when the editor upgrades.

**Build-time backstops** (keep regardless of the pins):

- **Frontend (Vite):** `resolve.dedupe: ['yjs', 'lexical', '@lexical/*', …]` forces one copy
  at bundle time even if install dedup slips.
- **rtc-server (`/server`):** esbuild-bundle the server nodes with `yjs`/`lexical`/`@lexical/*`
  **externalized**, so the bundle shares rtc-server's single instance (Phase 2 `bundle:nodes`).

### Testing branch changes locally

Build the branch and drop its `dist` into this repo's installed copy — good for a quick check:

```bash
cd /Users/apple/Documents/doc-editor/packages/doc-editor && yarn build
cp -R dist/* \
  /Users/apple/Documents/toddle-compose/node_modules/@toddle-edu/ds-doc-editor/dist/
```

Overwritten on the next `pnpm install`, so it's a smoke-test path only. For sustained
branch work, consume doc-editor as a workspace package (`workspace:*`) or its published
version and rebuild it on change.

**The `/server` export caveat:** `./server` ships raw ESM source pulling its own Lexical/Yjs.
For rtc-server (CJS), esbuild-bundle the server nodes with `lexical`/`@lexical/*`/`yjs`
**externalized** so they share rtc-server's single instances — see the rtc-server `bundle:nodes`
script (added in Phase 2). Pass Yjs **bytes** across the boundary, never live `Y.Doc` objects.

## Tooling

| Command              | What it does                          |
|----------------------|---------------------------------------|
| `pnpm lint`          | ESLint (flat config) across the repo  |
| `pnpm format`        | Prettier write                        |
| `pnpm format:check`  | Prettier check (CI)                   |
| `pnpm typecheck`     | Per-package `tsc --noEmit`            |
| `pnpm dev`           | Run backend + rtc + frontend together |
| `pnpm db:up` / `db:down` | Start / stop the Postgres container |

Shared config: `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.editorconfig`.
Per-package `tsconfig.json` files extend `../tsconfig.base.json`.
