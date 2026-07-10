# Local → Deployment (frontend + ds-doc-editor)

How the local `@toddle-edu/ds-doc-editor` build flows into a Netlify production
deploy, why prod builds historically broke, and the exact steps to build, verify,
and ship. Read this before touching the editor or the frontend build config.

---

## TL;DR — ship a change

```bash
# 1) Build the editor (only if you changed doc-editor source/config)
cd /Users/apple/Documents/doc-editor/packages/doc-editor
yarn build                       # -> dist/main.mjs (ESM) + dist/main.css

# 2) Build the frontend WITH prod URLs baked in (env vars matter at BUILD time)
cd /Users/apple/Documents/toddle-compose/frontend
VITE_API_BASE_URL=https://toddle-compose-backend-sg.onrender.com \
VITE_RTC_WS_URL=wss://toddle-compose-rtc-sg.onrender.com \
pnpm build

# 3) Upload the built dist (deploy does NOT build — it just uploads --dir)
netlify deploy \
  --site 28189552-7700-4ccc-b48d-99ce67cfa13d \
  --prod \
  --dir /Users/apple/Documents/toddle-compose/frontend/dist \
  --no-build
```

> Auth: prefer `netlify login` or `export NETLIFY_AUTH_TOKEN=…` over `--auth <token>`
> on the command line (it leaks into shell history / logs).

---

## How the pieces connect

- `frontend/node_modules/@toddle-edu/ds-doc-editor` is a **symlink** to the local
  checkout `/Users/apple/Documents/doc-editor/packages/doc-editor`. The frontend
  imports the package's **built output** (`dist/main.mjs`), not its `src`.
- The frontend reads `dist/main.mjs` via the package's `main`/`module`/`exports`.
  After editing editor source you MUST `yarn build` in the doc-editor repo, then
  rebuild the frontend (and clear Vite's cache: `rm -rf frontend/node_modules/.vite`).
- `netlify deploy` (CLI, manual) **builds locally on your machine**, so it uses
  your `node_modules` → the **symlinked local editor build** is what gets deployed.
- `frontend/package.json` is committed as `"@toddle-edu/ds-doc-editor": "0.10.0"`
  (the registry version). The local `link:` override is a **working-tree-only**
  change — see "Gotchas".

---

## The editor MUST be built as ESM (not UMD)

The doc-editor's `webpack.config.js` emits a real **ES module**. Do not revert it to
UMD — a UMD bundle that externalizes react/`@toddle-edu/*` breaks Vite **production**
builds in three different ways (dev always worked, which masked this):

| Symptom (browser console)                                                 | Cause                                                                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"Y" is not exported by …main.js` (build fails)                           | rollup's CJS lexer only detects the UMD library name                                                                                                        |
| `Cannot read properties of undefined (reading 'createContext')`           | Vite leaves the UMD un-wrapped → it runs its `window.*` global-fallback branch → externals are `undefined`                                                  |
| `n.hasOwnProperty is not a function` (crashes **every** page incl. login) | external `import * as from "@toddle-edu/ds-icons"` defeats tree-shaking → app's ds-icons interop'd as a null-proto ES namespace → trips a latent ds-web bug |

**Do NOT try to fix these from `frontend/vite.config.ts`** with `commonjsOptions`
(`transformMixedEsModules`, `strictRequires`, …). Each one fixes a single symptom
and introduces another (notably the `hasOwnProperty` crash). The fix belongs in the
editor's build.

### Required doc-editor build config (`webpack.config.js`)

```js
experiments: { outputModule: true },
externalsType: "module",
output: {
  filename: "main.mjs",
  module: true,
  library: { type: "module" },
  clean: true,
},
// Externalize ONLY react/react-dom (incl. subpaths) so the editor shares the host
// app's single React (required for hooks). Do NOT externalize @toddle-edu/* —
// bundle them so the editor is self-contained and never reshapes the host app's DS.
externals: [/^react($|\/)/, /^react-dom($|\/)/],
```

### Required `package.json` fields

```json
"main": "dist/main.mjs",
"module": "dist/main.mjs",
"exports": {
  ".": "./dist/main.mjs",
  "./dist/main.css": "./dist/main.css",
  "./dist/*": "./dist/*"
}
```

After this: `frontend` `vendor-ds` chunk is ~1MB (editor no longer pollutes it); the
self-contained editor is a ~4.4MB **lazy** chunk (only loaded on doc pages).
`DocEditor.tsx` uses plain named imports — `Y`/`WebsocketProvider` come from the
editor's **bundled** yjs/y-websocket (do not add a separate `yjs` to the frontend).

---

## Verify before shipping (catches runtime breaks a green build hides)

A passing `pnpm build` is NOT enough — every bug above produced a green build. Smoke
test the real bundle in a browser:

```bash
# serve the production build locally
cd frontend && npx vite preview --port 4190 --strictPort &
# then load http://localhost:4190 and confirm the LOGIN page renders with no
# console errors (CORS errors against the prod backend are expected from localhost).
```

For the full flow (sign-in + doc page) test on the **deployed** domain (CORS is only
configured for the Netlify origin):

1. Open https://doc-editor-1.netlify.toddleapp.com/
2. Sign in (test creds: `owner@toddle.test` / `password123`) → lands on `/launcher`.
3. Open a doc, e.g. `/w/<workspaceId>?doc=<docId>` → editor mounts ("Start writing…"),
   no console/page errors. (The page never reaches network-idle — the RTC WebSocket
   stays open; that's normal.)

---

## Gotchas

- **`netlify deploy` does not build.** The `VITE_*` env vars only take effect during
  `pnpm build`. Always build first, then `deploy --no-build --dir …/frontend/dist`.
  Build with the prod `VITE_API_BASE_URL`/`VITE_RTC_WS_URL` or the deployed app calls
  the wrong backend.
- **Don't commit the `link:` line** in `frontend/package.json` — keep it `"0.10.0"`.
  The absolute `link:` path doesn't exist in CI; committing it breaks the
  `develop → staging/frontend` Action build.
- **Registry `0.10.0` is the OLD UMD.** The ESM build only reaches deploys via the
  local `link:` (because the CLI builds locally). For CI / teammates to get the fix,
  **publish a new ESM version** of the package and bump the frontend dep, or use a
  `file:` tarball (`pnpm pack`).
- **`pnpm install` replaces the symlink** with the registry copy. Re-create the
  `link:` (or restore the symlink) afterward; verify with
  `readlink -f frontend/node_modules/@toddle-edu/ds-doc-editor`.
- **Netlify publish dir.** `.netlify/netlify.toml` has a UI-set `publish` that can
  resolve to a doubled `frontend/frontend/dist`; pass an absolute `--dir` to be safe.
- **Token hygiene.** Rotate any Netlify auth token that ends up in a command line /
  chat / log.
