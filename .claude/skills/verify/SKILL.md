---
name: verify
description: Drive toddle-compose end-to-end in a browser to verify frontend/backend changes at the real surface.
---

# Verifying toddle-compose changes

## Stack

`pnpm dev:services` runs backend :4000, rtc :4001, frontend :5173 (postgres via
`pnpm db:up`). Often already running — probe with
`curl -so /dev/null -w '%{http_code}' http://localhost:5173` before starting anything.
Schema changes: `pnpm db:push` (root .env has DATABASE_URL). Prisma client:
`pnpm --filter @app/database generate` (backend dev watcher does NOT reload on
generated-client changes, only on src edits).

## Browser harness

No playwright in this repo. Use a sibling repo's install + system Chrome:

```bash
export NODE_PATH=/Users/apple/Documents/Toddle/doc-editor/node_modules
# in the script:
chromium.launch({ channel: 'chrome', headless: true })   # no downloaded browsers exist
```

Pattern-match tests/image-upload.playwright.cjs for API bootstrap: login
`owner@toddle.test` / `password123`, create workspace, `/auth/workspace/enter`,
then seed the browser via addInitScript:

```js
localStorage.setItem('tc-auth', JSON.stringify({ state: { refreshToken, lastActiveWorkspaceId: wsId }, version: 0 }));
```

## Gotchas

- **One hard page-load per context.** The dev auth bootstrap rotates the refresh
  token; a second `page.goto` in the same context often 401s on /auth/refresh and
  dumps you at the login screen. Do a fresh API login + fresh browser context per
  page load; SPA navigation within a load is fine.
- First hit on a lazy route after adding a dependency stalls while vite
  pre-bundles it — warm the route once (or wait >30s) before asserting.
- The "New page" center button only exists in the empty workspace state; the
  sidebar "New page" row is always there (`aside >> text=New page`).
- Editor mount selectors: doc `.ds-de-contentEditable`, sheet grid, tldraw
  `.tl-canvas`, excalidraw `.excalidraw`, react flow `.react-flow`.
- Console is noisy with pre-existing antd/DS warnings — filter, don't fail on them.
