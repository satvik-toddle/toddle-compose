# Deployment flow (scratch)

> Temp summary. Full setup lives in `deploy.md`.

## The model

`develop` → **PR into a staging branch** → review → **merge** → GitHub Action deploys.

```
develop ──PR──▶ staging/frontend            ──merge(push)──▶ Action ──▶ Netlify
        ──PR──▶ staging/backend-rtc-server  ──merge(push)──▶ Action ──▶ Render hooks ──▶ backend + rtc
```

## On a PR (review gate)

- Action runs the **build only** (no deploy).
- Green check = safe to merge.

## On merge (push to staging/\*)

- **Frontend:** build Vite app → `netlify-cli deploy --prod`.
- **Backend+RTC:** build both (the gate) → if green, curl the two **Render deploy hooks** → Render rebuilds from the branch.

## To ship

```bash
gh pr create --base staging/frontend           --head develop   # frontend
gh pr create --base staging/backend-rtc-server  --head develop   # backend + rtc
# review → merge → auto-deploys
```

Watch: `gh run list`.

## Config (one-time, already set)

- **Secrets:** `GH_PACKAGES_TOKEN`, `NETLIFY_AUTH_TOKEN`, `RENDER_DEPLOY_HOOK_BACKEND`, `RENDER_DEPLOY_HOOK_RTC`
- **Variables:** `VITE_API_BASE_URL`, `VITE_RTC_WS_URL` (build-time → take effect on next frontend deploy)
- **Render auto-deploy: OFF** — the Action's hook is the only trigger.

## Notes

- Deploys ship **committed** state; build must pass or Render is never triggered.
- Editing a `.github/workflows/*` file → push needs SSH or a `workflow`-scoped PAT (routine code pushes don't).
- Rollback: open a PR from an older commit, or `DEPLOY_SOURCE=<sha> pnpm staging:backend`.
