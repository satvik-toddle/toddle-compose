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
