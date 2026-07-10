# Deployment guide

How **toddle-compose** ships to staging: the frontend to **Netlify**, the backend
and rtc-server to **Render**, driven by two GitHub Actions.

## How it works

Pushing to a staging branch triggers a GitHub Action that builds, then deploys:

| Branch | Workflow | Builds | Deploys to |
|--------|----------|--------|------------|
| `staging/frontend` | `.github/workflows/deploy-frontend.yml` | Vite app | Netlify (via `netlify-cli`) |
| `staging/backend-rtc-server` | `.github/workflows/deploy-backend-rtc.yml` | backend + rtc-server | Render (via deploy hooks) |

You don't push these branches by hand — use the helper scripts:

```bash
pnpm release            # frontend + backend + rtc  (whole stack)
pnpm staging:frontend   # → staging/frontend            (Netlify)
pnpm staging:backend    # → staging/backend-rtc-server  (Render: backend + rtc)
```

Each script force-updates the deploy branch to your current `HEAD` (commit first —
it ships committed state, not your working tree). See `scripts/release.sh`.

> **Render auto-deploy is OFF.** The Action is the trigger: it builds first (the
> gate), then curls the Render deploy hooks. Leaving Render auto-deploy on would
> double-deploy.

---

## One-time setup

### 0. Prerequisites
- A token with **`read:packages`** for the `@toddle-edu` org (frontend pulls the
  editor from the private GitHub npm registry).
- To *push* the workflow files, your git PAT needs the **`workflow`** scope, or push
  over SSH (`git remote set-url origin git@github.com:<org>/toddle-compose.git`).

### 1. Database (Render Postgres)
The app uses **two** databases on one instance: `toddle_compose` (app) and
`toddle_compose_rtc` (write-heavy Yjs store).

1. Render → **New + → Postgres**.
   - **Name:** `toddle-compose-db` (hyphens OK here)
   - **Database:** `toddle_compose` (must match `^[a-z_][a-z0-9_]*$` — lowercase /
     digits / underscores only, no hyphens)
   - **User:** `toddle`
   - Pick a region and **use the same region for every service** (private networking).
2. Copy the **Internal** and **External** connection URLs.
3. Create the second database (from your laptop, against the **External** URL):
   ```bash
   psql "<EXTERNAL_DATABASE_URL>?sslmode=require" -c "CREATE DATABASE toddle_compose_rtc;"
   ```

The two env values (services use the **Internal** host; same region):
```
DATABASE_URL=postgresql://toddle:<pw>@<internal-host>/toddle_compose
RTC_DATABASE_URL=postgresql://toddle:<pw>@<internal-host>/toddle_compose_rtc
```

### 2. Populate the database
Run once from your laptop, pointing at the **External** URLs (`?sslmode=require`).
`db:provision` reads the URLs from the environment, pushes the schema to both
databases, and creates the realm + owner in one step:

```bash
DATABASE_URL="<ext app url>" RTC_DATABASE_URL="<ext rtc url>" \
  REALM_OWNER_EMAIL="owner@toddle.app" REALM_OWNER_PASSWORD="<strong-pw>" \
  pnpm db:provision
```

Optional env: `REALM_ID` (default `realm_toddle`), `REALM_NAME`, `REALM_OWNER_NAME`.
It is idempotent, so re-running is safe.

> **Do not** use the older `DATABASE_URL=… pnpm db:push` / `db:init` form: those
> scripts source `./.env`, which overwrites the `DATABASE_URL` you pass and silently
> targets your local DB. `db:provision` never sources `.env`.

> **Connection poolers** (e.g. Supabase transaction pooler — `:6543`,
> `?pgbouncer=true`) can't run schema DDL. Pass the **direct** connection (port
> 5432) via `DATABASE_URL_DIRECT` / `RTC_DATABASE_URL_DIRECT` for the push, while
> `DATABASE_URL` / `RTC_DATABASE_URL` stay on the pooler for runtime.

`db:seed` is **local-only** demo data — don't run it against staging.

### 3. Backend keys
Three secrets. Generate them once.

```bash
openssl rand -hex 32     # JWT_USER_SECRET  (signs user access JWTs; min 32)
openssl rand -hex 32     # INTERNAL_TOKEN   (backend↔rtc shared secret; SAME on both services)
```

**RTC RS256 keypair** (signs RTC tokens / backs the JWKS endpoint). The backend
auto-generates one on first boot, but Render's filesystem is **ephemeral** — that
would mint a new keypair every restart and invalidate live tokens. So generate a
fixed pair and inject it:

```bash
# private key: PKCS8 PEM (-----BEGIN PRIVATE KEY-----)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out rtc-private.pem
# public key: SPKI PEM   (-----BEGIN PUBLIC KEY-----)
openssl rsa -in rtc-private.pem -pubout -out rtc-public.pem
```

On the backend service → **Environment → Secret Files**, add `rtc-private.pem` and
`rtc-public.pem` (paste the PEM contents). They mount at `/etc/secrets/…`. Only the
backend needs them; the rtc-server just fetches the public JWK over HTTP.

### 4. Render — backend web service
**New + → Web Service** → connect the repo.
- **Branch:** `staging/backend-rtc-server` · **Region:** same as Postgres · **Root Directory:** _(blank)_ · **Auto-Deploy: No**
- **Build Command:**
  ```
  npm install -g pnpm@9.12.3 && pnpm install --filter backend... --frozen-lockfile --prod=false && pnpm --filter @app/database generate && pnpm --filter backend build
  ```
  (`--filter backend...` skips the frontend, so Render never needs the `@toddle-edu` token.
  `--prod=false` forces devDependencies (prisma, @nestjs/cli) to install even with
  `NODE_ENV=production` set — the build needs them. Use `npm install -g pnpm`, **not**
  `corepack enable` — corepack can't symlink into Render's read-only `/usr/bin`. The repo's
  `.node-version` pins Node 20.)
- **Start Command:** `pnpm --filter backend start`
- **Health Check Path:** `/health`
- **Environment:**
  ```
  NODE_ENV=production
  JWT_USER_SECRET=<openssl rand -hex 32>
  INTERNAL_TOKEN=<openssl rand -hex 32>            # same value on rtc-server
  DATABASE_URL=<Internal app DB URL>
  REALM_ID=realm_toddle
  CORS_ORIGINS=https://<your-netlify-domain>
  BACKEND_PUBLIC_URL=https://<backend>.onrender.com
  RTC_INTERNAL_URL=http://<rtc-service-name>:10000 # rtc over the private network (same port as WS)
  RTC_PRIVATE_KEY_PATH=/etc/secrets/rtc-private.pem
  RTC_PUBLIC_KEY_PATH=/etc/secrets/rtc-public.pem
  ```
  (Render port-detects 4000; if it reports no open port, add `BACKEND_PORT=10000`.)

### 5. Render — rtc-server web service
**New + → Web Service** → same repo, **branch `staging/backend-rtc-server`**, same region, root blank, **Auto-Deploy: No**.
- **Build Command:**
  ```
  npm install -g pnpm@9.12.3 && pnpm install --filter rtc-server... --frozen-lockfile --prod=false && pnpm --filter @app/rtc-database generate && pnpm --filter rtc-server build
  ```
  (The Lexical server-nodes bundle is committed at `rtc-server/vendor/server-nodes.cjs`,
  so no `doc-editor` checkout is needed.)
- **Start Command:** `pnpm --filter rtc-server start`
- **Environment:**
  ```
  NODE_ENV=production
  INTERNAL_TOKEN=<same value as backend>
  RTC_DATABASE_URL=<Internal rtc DB URL>           # …/toddle_compose_rtc
  JWKS_URL=https://<backend>.onrender.com/.well-known/rtc-jwks.json
  RTC_PORT=10000                                    # single port: public WS + internal API
  ```
  > rtc-server serves browser WebSockets and the internal HTTP API on the one
  > `RTC_PORT`; set it to Render's assigned port (default `10000`). The backend
  > reaches `/internal/*` on that same port over the private network.

### 6. Deploy hooks → GitHub secrets
Each Render service → **Settings → Deploy Hook** → copy the URL. Then:
```bash
gh secret set RENDER_DEPLOY_HOOK_BACKEND --body "<backend hook url>"
gh secret set RENDER_DEPLOY_HOOK_RTC     --body "<rtc hook url>"
```

### 7. Frontend (Netlify)
- Create/connect a Netlify site. Its **Site ID** is referenced inline in
  `deploy-frontend.yml` (`--site=…`); update it there if the site changes.
- The workflow builds and uploads `frontend/dist` with `netlify-cli`. `--filter=frontend`
  tells the CLI which monorepo package to deploy.

### 8. GitHub secrets & variables (summary)
Repo → **Settings → Secrets and variables → Actions**.

| Kind | Name | Used by |
|------|------|---------|
| Secret | `GH_PACKAGES_TOKEN` | both workflows (install `@toddle-edu/*`) |
| Secret | `NETLIFY_AUTH_TOKEN` | frontend deploy |
| Secret | `RENDER_DEPLOY_HOOK_BACKEND` | backend deploy |
| Secret | `RENDER_DEPLOY_HOOK_RTC` | rtc-server deploy |
| Variable | `VITE_API_BASE_URL` | frontend build → `https://<backend>.onrender.com` (no `/api`; code adds it) |
| Variable | `VITE_RTC_WS_URL` | frontend build → `wss://<rtc>.onrender.com` (code adds `/yjs/<docId>`) |

```bash
gh variable set VITE_API_BASE_URL --body "https://<backend>.onrender.com"
gh variable set VITE_RTC_WS_URL   --body "wss://<rtc>.onrender.com"
```

---

## Releasing

```bash
pnpm staging:frontend   # ship the frontend
pnpm staging:backend    # ship backend + rtc
pnpm release            # ship everything
```

Watch the runs: `gh run list` (or the repo's Actions tab). Both workflows also
support manual re-runs via **workflow_dispatch**.

## Gotchas worth remembering
- **Commit before releasing** — the scripts push committed state, not your working tree.
- **Pushing workflow files** needs a `workflow`-scoped PAT, or push over SSH.
- **Keys are ephemeral on Render** unless provided as Secret Files (Step 3).
- **rtc two-port model** — set `RTC_PORT` to Render's external port (Step 5).
- **`@toddle-edu/ds-icons` is patched** (`patches/@toddle-edu__ds-icons@1.21.1.patch`)
  to fix a `hasOwnProperty` crash under Vite; `pnpm install` applies it automatically.
- **rtc server-nodes bundle** is committed (`rtc-server/vendor/server-nodes.cjs`);
  regenerate with `pnpm --filter rtc-server bundle:nodes` if the editor's nodes change.
