#!/usr/bin/env bash
#
# Release / deploy driver — pushes committed code to the staging branches that
# kick off the deploy GitHub Actions. Each push triggers a workflow that BUILDS
# and then PUSHES to the provider:
#   • staging/frontend            → .github/workflows/deploy-frontend.yml
#                                    builds the Vite app, deploys dist/ to Netlify.
#   • staging/backend-rtc-server  → .github/workflows/deploy-backend-rtc.yml
#                                    builds backend + rtc-server, triggers Render.
#
# Usage:
#   pnpm release            # frontend + backend + rtc  (the whole stack)
#   pnpm staging:frontend   # frontend → Netlify only
#   pnpm staging:backend    # backend + rtc-server → Render only
#
# It force-updates the remote deploy branch to your current HEAD (override with
# DEPLOY_SOURCE=<ref>). It ships COMMITTED state — commit first; a dirty working
# tree is warned about, never deployed.
#
# Config (env vars; auto-loaded from ./.env if present):
#   DEPLOY_REMOTE          git remote to push to           (default: origin)
#   DEPLOY_SOURCE          ref / branch / SHA to deploy     (default: HEAD)
#   NETLIFY_DEPLOY_BRANCH  branch the frontend workflow watches (default: staging/frontend)
#   RENDER_DEPLOY_BRANCH   branch the backend+rtc workflow watches (default: staging/backend-rtc-server)
#   RELEASE_YES=1          skip the confirmation prompt (required in CI / non-TTY)
set -euo pipefail

# Repo root = parent of this script's dir, regardless of where it's invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---- pretty output --------------------------------------------------------
if [ -t 1 ]; then
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_OFF=''
fi
note() { printf '%s▶ %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
ok()   { printf '%s✓ %s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }
err()  { printf '%s✗ %s%s\n' "$C_RED" "$1" "$C_OFF" >&2; }
step() { printf '\n%s── %s ──%s\n' "$C_DIM" "$1" "$C_OFF"; }

# Load .env (non-fatal if absent) so deploy-branch / remote overrides live in one place.
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi

DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_SOURCE="${DEPLOY_SOURCE:-HEAD}"
NETLIFY_DEPLOY_BRANCH="${NETLIFY_DEPLOY_BRANCH:-staging/frontend}"
RENDER_DEPLOY_BRANCH="${RENDER_DEPLOY_BRANCH:-staging/backend-rtc-server}"

# Ask a yes/no question. Auto-"no" off a TTY (unless RELEASE_YES=1) so CI never hangs.
confirm() {
  local prompt="$1"
  if [ "${RELEASE_YES:-}" = "1" ]; then return 0; fi
  if [ ! -t 0 ]; then
    err "Non-interactive shell and RELEASE_YES is not set — refusing to deploy: $prompt"
    return 1
  fi
  local reply
  printf '%s%s [y/N] %s' "$C_YELLOW" "$prompt" "$C_OFF"
  read -r reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# Push $DEPLOY_SOURCE onto a remote deploy branch, force-updating it. The deploy
# branch is just a pointer to "what should be live", so a force-update is expected.
# --force-with-lease keeps it safe: it refuses if the remote moved under us since
# our last fetch (someone else deployed), instead of clobbering blindly.
deploy_to_branch() {
  local label="$1" branch="$2"
  local sha subject
  sha="$(git rev-parse --short "$DEPLOY_SOURCE")"
  subject="$(git log -1 --format=%s "$DEPLOY_SOURCE")"

  step "$label"
  note "remote   : $DEPLOY_REMOTE"
  note "deploying: $DEPLOY_SOURCE ($sha) — $subject"
  note "→ branch : $branch"

  # Refresh our view of the remote deploy branch so --force-with-lease is accurate.
  git fetch --quiet "$DEPLOY_REMOTE" "$branch" 2>/dev/null || true

  if git push --force-with-lease "$DEPLOY_REMOTE" "$DEPLOY_SOURCE:refs/heads/$branch"; then
    ok "$label pushed → $DEPLOY_REMOTE/$branch (GitHub Action will build & deploy)"
  else
    err "$label push rejected. The remote branch moved since your last fetch"
    err "(a concurrent deploy?). Re-run, or force with: git push --force $DEPLOY_REMOTE $DEPLOY_SOURCE:$branch"
    return 1
  fi
}

deploy_frontend() { deploy_to_branch "frontend → Netlify"          "$NETLIFY_DEPLOY_BRANCH"; }
deploy_backend()  { deploy_to_branch "backend + rtc-server → Render" "$RENDER_DEPLOY_BRANCH"; }

# ---- pre-flight -----------------------------------------------------------
preflight() {
  local what="$1"
  step "Pre-flight"
  # We push a committed ref, not the working tree — surface uncommitted work.
  if [ -n "$(git status --porcelain)" ]; then
    warn "Working tree has uncommitted changes — they will NOT be deployed."
    warn "Only committed state at $DEPLOY_SOURCE ships. Commit first if needed."
  else
    ok "Working tree clean."
  fi
  confirm "Deploy $what now?" || { err "Aborted."; exit 1; }
}

# ---- dispatch -------------------------------------------------------------
case "${1:-all}" in
  frontend)
    preflight "the frontend (Netlify)"
    deploy_frontend
    ;;
  backend)
    preflight "the backend + rtc-server (Render)"
    deploy_backend
    ;;
  all|"")
    preflight "the FULL stack — frontend (Netlify) + backend & rtc (Render)"
    deploy_frontend
    deploy_backend
    ;;
  *)
    err "Unknown target: $1"
    echo "Usage: release.sh [frontend|backend|all]" >&2
    exit 2
    ;;
esac

step "Done"
ok "Deploy push(es) complete. Watch the GitHub Actions run for build & deploy status."
