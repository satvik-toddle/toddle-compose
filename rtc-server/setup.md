# Local setup — doc-editor server nodes

The rtc-server bundles the Lexical **server nodes** from the
[`toddle-edu/doc-editor`](https://github.com/toddle-edu/doc-editor) repo into
`vendor/server-nodes.cjs` (used by the headless Lexical extractor) via
`pnpm --filter rtc-server bundle:nodes`.

The bundle entry is **configured, not hardcoded** — `scripts/bundle-server-nodes.mjs`
reads it from `package.json` → `docEditor.serverNodesEntry` (override per-machine with
the `RTC_SERVER_NODES_ENTRY` env var). This guide wires up a local doc-editor checkout
for development.

> Once the doc-editor changes are released as `@toddle-edu/ds-doc-editor`, repoint
> `docEditor.serverNodesEntry` at the published package and skip this guide.

All paths below assume the **default sibling layout** — `doc-editor` cloned next to
`toddle-compose`:

```
…/Documents/
  ├── toddle-compose/   ← this repo
  └── doc-editor/        ← toddle-edu/doc-editor
```

---

## 1. Is the doc-editor repo cloned?

From the **toddle-compose repo root**:

```bash
if [ -d ../doc-editor/.git ]; then
  echo "found: $(cd ../doc-editor && pwd)"
else
  echo "NOT cloned — cloning as a sibling…"
  git -C .. clone https://github.com/toddle-edu/doc-editor.git
fi
```

## 2. Check out the `temp/lexical-yjs` branch

This is the branch the editor integration tracks (see the `comment` in toddle-compose's
root `package.json`).

```bash
cd ../doc-editor
git fetch origin
git checkout temp/lexical-yjs
git pull --ff-only
```

## 3. Install & build doc-editor

```bash
yarn
yarn build   # → yarn workspace @toddle-edu/ds-doc-editor build
```

The build output is consumed both by the frontend's symlinked `@toddle-edu/ds-doc-editor`
and by the rtc-server node bundle in step 5.

## 4. Point rtc-server at your checkout

- **Sibling layout (default):** nothing to do — `rtc-server/package.json` →
  `docEditor.serverNodesEntry` already resolves to
  `../../doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js`.
- **Cloned elsewhere:** set the path either way:
  - edit `rtc-server/package.json` → `docEditor.serverNodesEntry` (absolute, or relative
    to the `rtc-server/` dir), **or**
  - export an override (takes precedence):
    ```bash
    export RTC_SERVER_NODES_ENTRY="/abs/path/to/doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js"
    ```

## 5. Bundle the server nodes

```bash
cd ../toddle-compose                      # back to this repo
pnpm --filter rtc-server bundle:nodes     # → rtc-server/vendor/server-nodes.cjs
```

Re-run this whenever you rebuild doc-editor.

## 6. Run the app

```bash
pnpm dev
```

---

### Troubleshooting

- **`No doc-editor server-nodes entry configured`** — neither `RTC_SERVER_NODES_ENTRY`
  nor `docEditor.serverNodesEntry` is set. See step 4.
- **esbuild "Could not resolve …AllNodesServer.js"** — the entry path doesn't exist.
  Confirm doc-editor is on `temp/lexical-yjs` (step 2) and built (step 3), and that the
  configured path points at it (step 4).
